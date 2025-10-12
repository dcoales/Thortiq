import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ulid } from "ulidx";

import type { Logger } from "../logger";
import type {
  IdentityStore,
  RegistrationConsentsRecord,
  RegistrationRecord
} from "../identity/types";
import type { PasswordHasher } from "../security/passwordHasher";
import type { SessionManager } from "./sessionService";
import type { DeviceService } from "./deviceService";
import type { SecurityAlertService } from "./securityAlertService";
import type { SlidingWindowRateLimiter } from "../security/rateLimiter";
import type { RegistrationConfig } from "../config";
import type { LoginSuccess } from "./authService";
import type { UserProfile, CredentialRecord } from "@thortiq/client-core";

export type RegistrationErrorCode =
  | "rate_limited"
  | "invalid_password"
  | "invalid_email"
  | "token_invalid"
  | "token_expired"
  | "server_error";

export class RegistrationError extends Error {
  readonly code: RegistrationErrorCode;
  readonly retryAfterMs?: number;

  constructor(message: string, code: RegistrationErrorCode, options: { retryAfterMs?: number } = {}) {
    super(message);
    this.name = "RegistrationError";
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export interface RegistrationRequest {
  readonly identifier: string;
  readonly password: string;
  readonly rememberDevice: boolean;
  readonly deviceDisplayName: string;
  readonly devicePlatform: string;
  readonly deviceId?: string;
  readonly locale?: string | null;
  readonly consents: RegistrationConsentsRecord;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface RegistrationResendRequest {
  readonly identifier: string;
  readonly ipAddress?: string;
}

export interface RegistrationVerifyRequest {
  readonly token: string;
  readonly rememberDevice: boolean;
  readonly deviceDisplayName: string;
  readonly devicePlatform: string;
  readonly deviceId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface RegistrationRequestResult {
  readonly verificationExpiresAt: number;
  readonly resendAvailableAt: number;
}

export interface RegistrationServiceOptions {
  readonly identityStore: IdentityStore;
  readonly passwordHasher: PasswordHasher;
  readonly sessionManager: SessionManager;
  readonly deviceService: DeviceService;
  readonly logger: Logger;
  readonly securityAlerts: SecurityAlertService;
  readonly rateLimiterPerIdentifier: SlidingWindowRateLimiter;
  readonly rateLimiterPerIp: SlidingWindowRateLimiter;
  readonly config: RegistrationConfig;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const MIN_PASSWORD_LENGTH = 12;

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const generateToken = (): string => randomBytes(48).toString("base64url");

const normaliseEmail = (identifier: string): string => identifier.trim().toLowerCase();

const inferDisplayName = (email: string): string => {
  const localPart = email.split("@")[0] ?? email;
  return localPart
    .replace(/[\W_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "New Thortiq User";
};

export class RegistrationService {
  private readonly store: IdentityStore;
  private readonly hasher: PasswordHasher;
  private readonly sessions: SessionManager;
  private readonly devices: DeviceService;
  private readonly logger: Logger;
  private readonly alerts: SecurityAlertService;
  private readonly rateLimiterPerIdentifier: SlidingWindowRateLimiter;
  private readonly rateLimiterPerIp: SlidingWindowRateLimiter;
  private readonly config: RegistrationConfig;

  constructor(options: RegistrationServiceOptions) {
    this.store = options.identityStore;
    this.hasher = options.passwordHasher;
    this.sessions = options.sessionManager;
    this.devices = options.deviceService;
    this.logger = options.logger;
    this.alerts = options.securityAlerts;
    this.rateLimiterPerIdentifier = options.rateLimiterPerIdentifier;
    this.rateLimiterPerIp = options.rateLimiterPerIp;
    this.config = options.config;
  }

  async requestRegistration(input: RegistrationRequest): Promise<RegistrationRequestResult> {
    const identifier = normaliseEmail(input.identifier);
    this.validatePassword(input.password);
    this.validateEmail(identifier);

    const now = Date.now();
    if (!this.rateLimiterPerIdentifier.allow(identifier, now)) {
      throw new RegistrationError("Too many requests for identifier", "rate_limited", {
        retryAfterMs: this.config.windowSeconds * 1000
      });
    }
    if (input.ipAddress && !this.rateLimiterPerIp.allow(input.ipAddress, now)) {
      throw new RegistrationError("Too many requests from IP address", "rate_limited", {
        retryAfterMs: this.config.windowSeconds * 1000
      });
    }

    const existingUser = await this.store.getUserByEmail(identifier);
    if (existingUser) {
      this.logger.info("Registration request for existing account suppressed", { identifier });
      return {
        verificationExpiresAt: now + this.config.tokenLifetimeSeconds * 1000,
        resendAvailableAt: now + this.config.resendCooldownSeconds * 1000
      };
    }

    const hashedPassword = await this.hasher.hash(input.password);
    const token = generateToken();
    const record = await this.prepareRegistrationRecord(identifier, hashedPassword, hashToken(token), input, now);
    await this.store.upsertRegistration(record);
    await this.deliverVerification(identifier, token, record);
    return {
      verificationExpiresAt: record.expiresAt,
      resendAvailableAt: record.resendAvailableAt
    };
  }

  async resendRegistration(input: RegistrationResendRequest): Promise<RegistrationRequestResult> {
    const identifier = normaliseEmail(input.identifier);
    const now = Date.now();
    if (!this.rateLimiterPerIdentifier.allow(identifier, now)) {
      throw new RegistrationError("Too many requests for identifier", "rate_limited", {
        retryAfterMs: this.config.windowSeconds * 1000
      });
    }
    if (input.ipAddress && !this.rateLimiterPerIp.allow(input.ipAddress, now)) {
      throw new RegistrationError("Too many requests from IP address", "rate_limited", {
        retryAfterMs: this.config.windowSeconds * 1000
      });
    }

    const existing = await this.store.getRegistrationByIdentifier(identifier);
    if (!existing) {
      this.logger.info("Resend requested without pending registration", { identifier });
      return {
        verificationExpiresAt: now + this.config.tokenLifetimeSeconds * 1000,
        resendAvailableAt: now + this.config.resendCooldownSeconds * 1000
      };
    }

    if (existing.attempts >= this.config.maxResendAttempts) {
      throw new RegistrationError("Maximum resend attempts reached", "rate_limited", {
        retryAfterMs: existing.resendAvailableAt > now ? existing.resendAvailableAt - now : this.config.windowSeconds * 1000
      });
    }

    if (existing.resendAvailableAt > now) {
      throw new RegistrationError("Resend not yet available", "rate_limited", {
        retryAfterMs: existing.resendAvailableAt - now
      });
    }

    const token = generateToken();
    const updated: RegistrationRecord = {
      ...existing,
      tokenHash: hashToken(token),
      updatedAt: now,
      expiresAt: now + this.config.tokenLifetimeSeconds * 1000,
      lastSentAt: now,
      resendAvailableAt: now + this.config.resendCooldownSeconds * 1000,
      attempts: Math.min(existing.attempts + 1, this.config.maxResendAttempts),
      completedAt: null
    };
    await this.store.upsertRegistration(updated);
    await this.deliverVerification(identifier, token, updated);
    return {
      verificationExpiresAt: updated.expiresAt,
      resendAvailableAt: updated.resendAvailableAt
    };
  }

  async verifyRegistration(input: RegistrationVerifyRequest): Promise<LoginSuccess> {
    const now = Date.now();
    const record = await this.store.getRegistrationByTokenHash(hashToken(input.token));
    if (!record) {
      throw new RegistrationError("Registration token not found", "token_invalid");
    }
    if (record.expiresAt <= now) {
      await this.store.deleteRegistration(record.id);
      throw new RegistrationError("Registration token expired", "token_expired");
    }

    const existingUser = await this.store.getUserByEmail(record.identifier);
    if (existingUser) {
      // Account already exists – treat as invalid token to prevent duplicate provisioning.
      await this.store.deleteRegistration(record.id);
      throw new RegistrationError("Account already verified", "token_invalid");
    }

    const user = this.createUserProfile(record, now);
    const credential = this.createCredentialRecord(user, record, now);
    await this.store.createUser({ user, credential, googleLink: null });

    const deviceResult = await this.devices.upsert({
      user,
      deviceId: input.deviceId,
      displayName: input.deviceDisplayName,
      platform: input.devicePlatform,
      trusted: input.rememberDevice,
      rememberDevice: input.rememberDevice,
      metadata: {
        registrationId: record.id
      }
    });

    const sessionResult = await this.sessions.createSession({
      user,
      device: deviceResult.device,
      credential,
      trustedDevice: input.rememberDevice,
      mfaCompleted: true,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      metadata: {
        registrationId: record.id,
        registrationCompletedAt: now
      }
    });

    if (deviceResult.created) {
      void this.alerts.notifyNewDeviceLogin({
        userId: user.id,
        deviceId: deviceResult.device.id,
        deviceDisplayName: deviceResult.device.displayName,
        devicePlatform: deviceResult.device.platform,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        sessionId: sessionResult.session.id
      });
    }

    await this.store.markRegistrationCompleted(record.id, now);
    await this.store.deleteRegistration(record.id);

    return {
      status: "success",
      user,
      session: sessionResult.session,
      device: deviceResult.device,
      tokens: sessionResult.tokens.pair,
      refreshToken: sessionResult.tokens.refreshToken,
      refreshExpiresAt: sessionResult.tokens.refreshExpiresAt,
      mfaCompleted: true
    };
  }

  private validateEmail(identifier: string) {
    if (!EMAIL_PATTERN.test(identifier)) {
      throw new RegistrationError("Enter a valid email address.", "invalid_email");
    }
  }

  private validatePassword(password: string) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new RegistrationError("Password must be at least 12 characters long.", "invalid_password");
    }
  }

  private async deliverVerification(identifier: string, token: string, record: RegistrationRecord): Promise<void> {
    const verificationUrl = this.composeVerificationUrl(token);
    if (this.config.devMailboxPath) {
      await this.writeDevMailbox(identifier, verificationUrl, record);
    }
    this.logger.info("Registration verification token issued", {
      identifier,
      registrationId: record.id,
      verificationUrl
    });
  }

  private composeVerificationUrl(token: string): string {
    const separator = this.config.verificationBaseUrl.includes("?") ? "&" : "?";
    return `${this.config.verificationBaseUrl}${separator}token=${encodeURIComponent(token)}`;
  }

  private async writeDevMailbox(identifier: string, verificationUrl: string, record: RegistrationRecord): Promise<void> {
    try {
      const mailboxDir = resolve(this.config.devMailboxPath!);
      await mkdir(mailboxDir, { recursive: true });
      const filePath = resolve(mailboxDir, `${record.id}.txt`);
      const contents = [
        `To: ${identifier}`,
        `Subject: Thortiq account verification`,
        "",
        "Complete your registration by visiting:",
        verificationUrl,
        "",
        `Token expires at: ${new Date(record.expiresAt).toISOString()}`
      ].join("\n");
      await writeFile(filePath, contents, "utf8");
    } catch (error) {
      this.logger.warn("Failed to write dev mailbox entry", {
        error: error instanceof Error ? error.message : "unknown"
      });
    }
  }

  private async prepareRegistrationRecord(
    identifier: string,
    hashedPassword: string,
    tokenHash: string,
    input: RegistrationRequest,
    now: number
  ): Promise<RegistrationRecord> {
    const existing = await this.store.getRegistrationByIdentifier(identifier);
    const id = existing?.id ?? ulid();
    return {
      id,
      identifier,
      tokenHash,
      passwordHash: hashedPassword,
      consents: input.consents,
      rememberDevice: input.rememberDevice,
      deviceDisplayName: input.deviceDisplayName,
      devicePlatform: input.devicePlatform,
      deviceId: input.deviceId ?? null,
      locale: input.locale ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      expiresAt: now + this.config.tokenLifetimeSeconds * 1000,
      lastSentAt: now,
      resendAvailableAt: now + this.config.resendCooldownSeconds * 1000,
      attempts: existing ? existing.attempts + 1 : 1,
      completedAt: null
    };
  }

  private createUserProfile(record: RegistrationRecord, now: number): UserProfile {
    return {
      id: ulid(),
      email: record.identifier,
      emailVerified: true,
      displayName: inferDisplayName(record.identifier),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      locale: record.locale ?? null
    };
  }

  private createCredentialRecord(user: UserProfile, record: RegistrationRecord, now: number): CredentialRecord {
    return {
      id: ulid(),
      userId: user.id,
      type: "password",
      hash: record.passwordHash,
      salt: null,
      metadata: {
        registrationId: record.id,
        rememberDevice: record.rememberDevice
      },
      createdAt: now,
      updatedAt: now,
      revokedAt: null
    };
  }
}
