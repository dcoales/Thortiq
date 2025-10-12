import type { DeviceRecord, SessionRecord, TokenPair, UserProfile } from "@thortiq/client-core";

import type { Logger } from "../logger";
import type { IdentityStore } from "../identity/types";
import type { PasswordHasher } from "../security/passwordHasher";
import type { TokenService } from "../security/tokenService";
import type { MfaService, ChallengeVerificationInput } from "./mfaService";
import type { SessionManager } from "./sessionService";
import type { DeviceService } from "./deviceService";

export interface LoginRequest {
  readonly identifier: string;
  readonly password: string;
  readonly deviceId?: string;
  readonly deviceDisplayName: string;
  readonly platform: string;
  readonly rememberDevice: boolean;
  readonly userAgent?: string;
  readonly ipAddress?: string;
  readonly mfaCode?: string;
  readonly mfaMethodId?: string;
}

export interface LoginSuccess {
  readonly status: "success";
  readonly user: UserProfile;
  readonly session: SessionRecord;
  readonly device: DeviceRecord;
  readonly tokens: TokenPair;
  readonly refreshToken: string;
  readonly refreshExpiresAt: number;
  readonly mfaCompleted: boolean;
}

export interface LoginMfaRequired {
  readonly status: "mfa_required";
  readonly user: UserProfile;
  readonly device: DeviceRecord;
  readonly methods: ReadonlyArray<{ id: string; type: string; label?: string | null }>;
  readonly sessionId: string | null;
}

export interface LoginFailure {
  readonly status: "failure";
  readonly reason: "invalid_credentials" | "account_locked";
}

export type LoginResult = LoginSuccess | LoginMfaRequired | LoginFailure;

export interface RefreshRequest {
  readonly refreshToken: string;
  readonly userAgent?: string;
  readonly ipAddress?: string;
  readonly rememberDevice: boolean;
}

export interface RefreshResult {
  readonly status: "success" | "invalid";
  readonly tokens?: TokenPair;
  readonly refreshToken?: string;
  readonly session?: SessionRecord;
  readonly refreshExpiresAt?: number;
}

export interface LogoutContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly revokeAll?: boolean;
}

export interface AuthServiceOptions {
  readonly identityStore: IdentityStore;
  readonly passwordHasher: PasswordHasher;
  readonly tokenService: TokenService;
  readonly mfaService: MfaService;
  readonly logger: Logger;
  readonly sessionManager: SessionManager;
  readonly deviceService: DeviceService;
}

export class AuthService {
  private readonly store: IdentityStore;
  private readonly passwordHasher: PasswordHasher;
  private readonly tokens: TokenService;
  private readonly mfa: MfaService;
  private readonly logger: Logger;
  private readonly sessions: SessionManager;
  private readonly devices: DeviceService;

  constructor(options: AuthServiceOptions) {
    this.store = options.identityStore;
    this.passwordHasher = options.passwordHasher;
    this.tokens = options.tokenService;
    this.mfa = options.mfaService;
    this.logger = options.logger;
    this.sessions = options.sessionManager;
    this.devices = options.deviceService;
  }

  async login(request: LoginRequest): Promise<LoginResult> {
    const user = await this.store.getUserByEmail(request.identifier);
    if (!user) {
      return { status: "failure", reason: "invalid_credentials" };
    }
    const credential = await this.store.getCredentialByUser(user.id, "password");
    if (!credential) {
      return { status: "failure", reason: "invalid_credentials" };
    }

    const passwordValid = await this.passwordHasher.verify(request.password, credential.hash);
    if (!passwordValid) {
      return { status: "failure", reason: "invalid_credentials" };
    }

    const trustedDevice = request.rememberDevice;

    const device = await this.devices.upsert({
      user,
      deviceId: request.deviceId,
      displayName: request.deviceDisplayName,
      platform: request.platform,
      trusted: trustedDevice,
      rememberDevice: request.rememberDevice,
      metadata: {
        loginMethod: "password"
      }
    });

    const mfaRequired = await this.mfa.isChallengeRequired(user.id, trustedDevice);
    if (mfaRequired && !request.mfaCode) {
      const methods = await this.mfa.listActiveMethods(user.id);
      return {
        status: "mfa_required",
        user,
        device,
        methods: methods.map((method) => ({ id: method.id, type: method.type, label: method.label })),
        sessionId: null
      };
    }

    const mfaCompleted = !mfaRequired;
    if (mfaRequired && request.mfaCode) {
      const verification: ChallengeVerificationInput = {
        userId: user.id,
        code: request.mfaCode,
        methodId: request.mfaMethodId
      };
      const result = await this.mfa.verifyChallenge(verification);
      if (!result.success) {
        return {
          status: "failure",
          reason: "invalid_credentials"
        };
      }
    }

    const sessionResult = await this.sessions.createSession({
      user,
      device,
      credential,
      trustedDevice,
      userAgent: request.userAgent,
      ipAddress: request.ipAddress,
      metadata: {
        loginMethod: "password"
      }
    });

    this.logger.info("User login successful", { userId: user.id, sessionId: sessionResult.session.id });

    return {
      status: "success",
      user,
      session: sessionResult.session,
      device,
      tokens: sessionResult.tokens.pair,
      refreshToken: sessionResult.tokens.refreshToken,
      refreshExpiresAt: sessionResult.tokens.refreshExpiresAt,
      mfaCompleted
    };
  }

  async refresh(request: RefreshRequest): Promise<RefreshResult> {
    const hash = this.tokens.hash(request.refreshToken);
    const session = await this.store.getSessionByRefreshHash(hash);
    if (!session || session.revokedAt) {
      return { status: "invalid" };
    }
    const user = await this.store.getUserById(session.userId);
    const device = await this.store.getDeviceById(session.deviceId);
    if (!user || !device) {
      return { status: "invalid" };
    }

    const rotated = await this.sessions.rotateSession({
      session,
      deviceTrusted: device.trusted,
      metadata: {
        refreshIpAddress: request.ipAddress,
        refreshUserAgent: request.userAgent
      }
    });

    await this.store.updateDeviceLastSeen(
      device.id,
      Date.now(),
      device.metadata ? { ...device.metadata, refreshedAt: Date.now() } : { refreshedAt: Date.now() }
    );

    return {
      status: "success",
      tokens: rotated.tokens.pair,
      refreshToken: rotated.tokens.refreshToken,
      refreshExpiresAt: rotated.tokens.refreshExpiresAt,
      session: {
        ...rotated.session
      }
    };
  }

  async logout(context: LogoutContext): Promise<void> {
    if (context.revokeAll) {
      await this.store.revokeSessionsByUser(context.userId, Date.now());
      return;
    }
    await this.store.revokeSession(context.sessionId, Date.now());
  }
}
