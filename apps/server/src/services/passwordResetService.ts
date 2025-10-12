import { createHash, randomBytes } from "node:crypto";

import { ulid } from "ulidx";

import type { CredentialRecord, PasswordResetRecord, UserProfile } from "@thortiq/client-core";

import type { Logger } from "../logger";
import type { IdentityStore } from "../identity/types";
import type { PasswordHasher } from "../security/passwordHasher";
import type { SlidingWindowRateLimiter } from "../security/rateLimiter";

export interface PasswordResetRequestInput {
  readonly identifier: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface PasswordResetRequestResult {
  readonly accepted: boolean;
  readonly token?: string;
  readonly record?: PasswordResetRecord;
  readonly user?: UserProfile | null;
}

export interface PasswordResetSubmitInput {
  readonly token: string;
  readonly newPassword: string;
}

export interface PasswordResetSubmitResult {
  readonly success: boolean;
}

export interface PasswordResetNotifier {
  sendResetNotification(entry: {
    readonly user: UserProfile;
    readonly token: string;
    readonly metadata: {
      readonly ipAddress?: string;
      readonly userAgent?: string;
    };
    readonly expiresAt: number;
  }): Promise<void>;
}

export interface PasswordResetServiceOptions {
  readonly identityStore: IdentityStore;
  readonly passwordHasher: PasswordHasher;
  readonly logger: Logger;
  readonly tokenLifetimeSeconds: number;
  readonly rateLimiterPerIdentifier: SlidingWindowRateLimiter;
  readonly rateLimiterPerIp: SlidingWindowRateLimiter;
  readonly notifier?: PasswordResetNotifier;
}

export class PasswordResetService {
  private readonly store: IdentityStore;
  private readonly passwordHasher: PasswordHasher;
  private readonly logger: Logger;
  private readonly tokenLifetimeSeconds: number;
  private readonly perIdentifierLimiter: SlidingWindowRateLimiter;
  private readonly perIpLimiter: SlidingWindowRateLimiter;
  private readonly notifier?: PasswordResetNotifier;

  constructor(options: PasswordResetServiceOptions) {
    this.store = options.identityStore;
    this.passwordHasher = options.passwordHasher;
    this.logger = options.logger;
    this.tokenLifetimeSeconds = options.tokenLifetimeSeconds;
    this.perIdentifierLimiter = options.rateLimiterPerIdentifier;
    this.perIpLimiter = options.rateLimiterPerIp;
    this.notifier = options.notifier;
  }

  async requestReset(input: PasswordResetRequestInput): Promise<PasswordResetRequestResult> {
    const now = Date.now();
    const identifierKey = input.identifier.toLowerCase();
    if (!this.perIdentifierLimiter.allow(identifierKey, now)) {
      return { accepted: false };
    }
    if (input.ipAddress && !this.perIpLimiter.allow(input.ipAddress, now)) {
      return { accepted: false };
    }

    const user = await this.store.getUserByEmail(identifierKey);
    if (!user) {
      // respond neutrally per spec.
      return { accepted: true };
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = this.hash(token);
    const createdAt = now;
    const expiresAt = now + this.tokenLifetimeSeconds * 1000;
    const record: PasswordResetRecord = {
      id: ulid(),
      userId: user.id,
      tokenHash,
      createdAt,
      expiresAt,
      usedAt: null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null
    };

    await this.store.createPasswordReset({ reset: record });

    if (this.notifier) {
      try {
        await this.notifier.sendResetNotification({
          user,
          token,
          metadata: {
            ipAddress: input.ipAddress,
            userAgent: input.userAgent
          },
          expiresAt
        });
      } catch (error) {
        this.logger.error("Failed to dispatch password reset email", {
          userId: user.id,
          error: error instanceof Error ? error.message : "unknown"
        });
      }
    }

    return {
      accepted: true,
      token,
      record,
      user
    };
  }

  async resetPassword(input: PasswordResetSubmitInput): Promise<PasswordResetSubmitResult> {
    const tokenHash = this.hash(input.token);
    const record = await this.store.getPasswordResetByTokenHash(tokenHash);
    if (!record) {
      return { success: false };
    }
    if (record.expiresAt <= Date.now()) {
      return { success: false };
    }
    const user = await this.store.getUserById(record.userId);
    if (!user) {
      return { success: false };
    }

    const credential = await this.store.getCredentialByUser(user.id, "password");
    const passwordHash = await this.passwordHasher.hash(input.newPassword);

    const now = Date.now();
    const updatedCredential: CredentialRecord = credential
      ? {
          ...credential,
          hash: passwordHash,
          updatedAt: now,
          revokedAt: null
        }
      : {
          id: ulid(),
          userId: user.id,
          type: "password",
          hash: passwordHash,
          salt: null,
          metadata: null,
          createdAt: now,
          updatedAt: now,
          revokedAt: null
        };

    await this.store.upsertCredential(updatedCredential);
    await this.store.markPasswordResetUsed(record.id, now);
    await this.store.revokeSessionsByUser(user.id, now);

    this.logger.info("Password reset successful", { userId: user.id });

    return { success: true };
  }

  private hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
