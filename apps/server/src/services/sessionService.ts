import { ulid } from "ulidx";

import type { CredentialRecord, DeviceRecord, SessionRecord, UserProfile } from "@thortiq/client-core";

import type { IdentityStore } from "../identity/types";
import type { TokenRotationResult, TokenService } from "../security/tokenService";

export interface SessionCreateOptions {
  readonly user: UserProfile;
  readonly device: DeviceRecord;
  readonly credential?: CredentialRecord | null;
  readonly trustedDevice: boolean;
  readonly mfaCompleted: boolean;
  readonly userAgent?: string;
  readonly ipAddress?: string;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export interface SessionCreateResult {
  readonly session: SessionRecord;
  readonly tokens: TokenRotationResult;
}

export interface SessionRotateOptions {
  readonly session: SessionRecord;
  readonly deviceTrusted: boolean;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export interface SessionRotateResult {
  readonly session: SessionRecord;
  readonly tokens: TokenRotationResult;
}

export interface SessionManagerOptions {
  readonly identityStore: IdentityStore;
  readonly tokenService: TokenService;
  readonly trustedDeviceLifetimeSeconds: number;
}

export class SessionManager {
  private readonly store: IdentityStore;
  private readonly tokens: TokenService;
  private readonly trustedDeviceLifetimeSeconds: number;

  constructor(options: SessionManagerOptions) {
    this.store = options.identityStore;
    this.tokens = options.tokenService;
    this.trustedDeviceLifetimeSeconds = options.trustedDeviceLifetimeSeconds;
  }

  async createSession(options: SessionCreateOptions): Promise<SessionCreateResult> {
    const now = Date.now();
    const sessionId = ulid();
    const rotation = this.tokens.rotateTokens(
      {
        userId: options.user.id,
        sessionId,
        deviceId: options.device.id,
        mfa: options.mfaCompleted
      },
      { trusted: options.trustedDevice }
    );

    const session: SessionRecord = {
      id: sessionId,
      userId: options.user.id,
      deviceId: options.device.id,
      refreshTokenHash: rotation.refreshTokenHash,
      userAgent: options.userAgent ?? null,
      ipAddress: options.ipAddress ?? null,
      metadata: {
        ...(options.metadata ?? {}),
        credentialId: options.credential?.id ?? null,
        loginAt: now,
        trustedDevice: options.trustedDevice,
        trustedUntil: options.trustedDevice ? now + this.trustedDeviceLifetimeSeconds * 1000 : null,
        mfaCompleted: options.mfaCompleted
      },
      createdAt: now,
      expiresAt: rotation.refreshExpiresAt,
      revokedAt: null
    };

    const stored = await this.store.createSession({ session });
    return {
      session: stored,
      tokens: rotation
    };
  }

  async rotateSession(options: SessionRotateOptions): Promise<SessionRotateResult> {
    const rotation = this.tokens.rotateTokens(
      {
        userId: options.session.userId,
        sessionId: options.session.id,
        deviceId: options.session.deviceId,
        mfa: true
      },
      { trusted: options.deviceTrusted }
    );

    await this.store.updateSessionRefresh({
      sessionId: options.session.id,
      refreshTokenHash: rotation.refreshTokenHash,
      expiresAt: rotation.refreshExpiresAt,
      metadata: {
        ...(options.session.metadata ?? {}),
        ...(options.metadata ?? {}),
        rotatedAt: Date.now()
      }
    });

    const updatedSession: SessionRecord = {
      ...options.session,
      refreshTokenHash: rotation.refreshTokenHash,
      expiresAt: rotation.refreshExpiresAt
    };

    return {
      session: updatedSession,
      tokens: rotation
    };
  }
}
