import { createHash, randomBytes } from "node:crypto";

import { authenticator } from "otplib";

import type { MfaMethodRecord, MfaMethodSummary } from "@thortiq/client-core";

import type { Logger } from "../logger";
import type { IdentityStore } from "../identity/types";
import type { EncryptedSecret, SecretVault } from "../security/secretVault";

interface BackupCodeEntry {
  readonly hash: string;
  readonly usedAt?: number | null;
}

interface TotpMetadata extends Readonly<Record<string, unknown>> {
  readonly backupCodes?: ReadonlyArray<BackupCodeEntry>;
  readonly digits?: number;
  readonly period?: number;
  readonly encryption?: EncryptedSecret;
  readonly issuer?: string;
  readonly enrollmentExpiresAt?: number;
}

interface VerificationResult {
  readonly success: boolean;
  readonly method?: MfaMethodRecord;
  readonly usedBackupCode?: boolean;
}

export interface MfaServiceOptions {
  readonly identityStore: IdentityStore;
  readonly logger: Logger;
  readonly window?: number;
  readonly vault: SecretVault;
  readonly totpIssuer: string;
  readonly enrollmentWindowSeconds: number;
  readonly backupCodeCount?: number;
}

export interface ChallengeVerificationInput {
  readonly userId: string;
  readonly code: string;
  readonly methodId?: string;
}

export class MfaService {
  private readonly store: IdentityStore;
  private readonly logger: Logger;
  private readonly window: number;
  private readonly vault: SecretVault;
  private readonly issuer: string;
  private readonly enrollmentWindowMs: number;
  private readonly backupCodeCount: number;

  constructor(options: MfaServiceOptions) {
    this.store = options.identityStore;
    this.logger = options.logger;
    this.window = options.window ?? 1;
    this.vault = options.vault;
    this.issuer = options.totpIssuer;
    this.enrollmentWindowMs = options.enrollmentWindowSeconds * 1000;
    this.backupCodeCount = options.backupCodeCount ?? 10;
  }

  async listActiveMethods(userId: string): Promise<ReadonlyArray<MfaMethodRecord>> {
    return this.store.getMfaMethodsByUser(userId);
  }

  async listMethodSummaries(userId: string): Promise<ReadonlyArray<MfaMethodSummary>> {
    const methods = await this.listActiveMethods(userId);
    return methods.map((method) => {
      const metadata = this.parseTotpMetadata(method);
      const backupCodesRemaining =
        metadata?.backupCodes?.filter((code) => !code.usedAt).length ?? null;
      return {
        id: method.id,
        type: method.type,
        label: method.label,
        createdAt: method.createdAt,
        updatedAt: method.updatedAt,
        verified: Boolean(method.verifiedAt),
        metadata: backupCodesRemaining !== null ? { backupCodesRemaining } : null
      };
    });
  }

  async isChallengeRequired(userId: string, trustedDevice: boolean): Promise<boolean> {
    if (trustedDevice) {
      return false;
    }
    const methods = await this.listActiveMethods(userId);
    return methods.length > 0;
  }

  async verifyChallenge(input: ChallengeVerificationInput): Promise<VerificationResult> {
    const methods = await this.listActiveMethods(input.userId);
    const candidates = input.methodId ? methods.filter((method) => method.id === input.methodId) : methods;

    for (const method of candidates) {
      if (method.type === "totp" && method.secret) {
        const result = await this.verifyTotpMethod(method, input.code);
        if (result.success) {
          return result;
        }
      }
      if (method.type === "backup-codes") {
        const result = await this.verifyBackupCode(method, input.code);
        if (result.success) {
          return result;
        }
      }
      if (method.type === "webauthn") {
        // WebAuthn verification is handled by a dedicated route. For now we log the attempt.
        this.logger.warn("WebAuthn verification attempted via generic challenge handler", { methodId: method.id });
      }
    }

    return { success: false };
  }

  async createTotpEnrollment(
    userId: string,
    label: string
  ): Promise<{ method: MfaMethodRecord; challenge: { methodId: string; otpauthUrl: string; secretBase32: string; backupCodes: ReadonlyArray<string>; expiresAt: number } }> {
    const timestamp = Date.now();
    const methodId = `totp-${userId}-${timestamp}`;
    const secret = authenticator.generateSecret();
    const encrypted = this.vault.encrypt(secret);
    const backupCodes = this.generateBackupCodes(this.backupCodeCount);
    const hashedBackup = backupCodes.map((code) => ({ hash: this.hashBackupCode(code), usedAt: null }));
    const metadata: TotpMetadata = {
      backupCodes: hashedBackup,
      digits: authenticator.options.digits,
      period: authenticator.options.step,
      encryption: encrypted,
      issuer: this.issuer,
      enrollmentExpiresAt: timestamp + this.enrollmentWindowMs
    };

    const method: MfaMethodRecord = {
      id: methodId,
      userId,
      type: "totp",
      secret: encrypted.ciphertext,
      label,
      metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      verifiedAt: null,
      disabledAt: null
    };

    await this.store.createOrUpdateMfaMethod(method);

    const otpauthUrl = authenticator.keyuri(label, this.issuer, secret);
    return {
      method,
      challenge: {
        methodId,
        otpauthUrl,
        secretBase32: secret,
        backupCodes,
        expiresAt: metadata.enrollmentExpiresAt ?? timestamp + this.enrollmentWindowMs
      }
    };
  }

  generateBackupCodes(count: number = 10): ReadonlyArray<string> {
    const codes: string[] = [];
    for (let index = 0; index < count; index += 1) {
      codes.push(randomBytes(5).toString("hex"));
    }
    return codes;
  }

  async regenerateBackupCodes(userId: string, methodId: string): Promise<ReadonlyArray<string>> {
    const methods = await this.listActiveMethods(userId);
    const method = methods.find((candidate) => candidate.id === methodId && candidate.type === "totp");
    if (!method) {
      throw new Error("TOTP method not found");
    }
    const metadata = this.parseTotpMetadata(method);
    if (!metadata) {
      throw new Error("TOTP metadata missing");
    }
    const codes = this.generateBackupCodes(this.backupCodeCount);
    const hashed = codes.map((code) => ({ hash: this.hashBackupCode(code), usedAt: null }));
    const updatedMetadata: TotpMetadata = {
      ...metadata,
      backupCodes: hashed
    };
    await this.store.createOrUpdateMfaMethod({
      ...method,
      metadata: updatedMetadata,
      updatedAt: Date.now()
    });
    return codes;
  }

  async removeMethod(userId: string, methodId: string): Promise<void> {
    const methods = await this.listActiveMethods(userId);
    const method = methods.find((candidate) => candidate.id === methodId && candidate.userId === userId);
    if (!method) {
      throw new Error("MFA method not found");
    }
    await this.store.removeMfaMethod(methodId);
  }

  async verifyTotpMethod(method: MfaMethodRecord, code: string): Promise<VerificationResult> {
    const metadata = this.parseTotpMetadata(method);
    authenticator.options = {
      digits: metadata?.digits ?? 6,
      step: metadata?.period ?? 30,
      window: this.window
    };
    const secret = this.decryptTotpSecret(method, metadata);
    if (!secret) {
      return { success: false };
    }
    if (!method.verifiedAt && metadata?.enrollmentExpiresAt && metadata.enrollmentExpiresAt < Date.now()) {
      this.logger.warn("TOTP enrollment expired before verification", { methodId: method.id, userId: method.userId });
      return { success: false };
    }
    const verified = authenticator.check(code, secret);
    if (verified) {
      if (!method.verifiedAt) {
        const verifiedAt = Date.now();
        const updatedMetadata: TotpMetadata | null = metadata
          ? {
              ...metadata,
              enrollmentExpiresAt: undefined
            }
          : null;
        await this.store.createOrUpdateMfaMethod({
          ...method,
          metadata: updatedMetadata,
          verifiedAt,
          updatedAt: verifiedAt
        });
        return { success: true, method: { ...method, metadata: updatedMetadata, verifiedAt: verifiedAt, updatedAt: verifiedAt } };
      }
      return { success: true, method };
    }
    return { success: false };
  }

  async verifyBackupCode(method: MfaMethodRecord, code: string): Promise<VerificationResult> {
    const metadata = this.parseTotpMetadata(method);
    if (!metadata?.backupCodes || metadata.backupCodes.length === 0) {
      return { success: false };
    }
    const hash = this.hashBackupCode(code);
    const entry = metadata.backupCodes.find((candidate) => candidate.hash === hash && !candidate.usedAt);
    if (!entry) {
      return { success: false };
    }
    const updated: TotpMetadata = {
      ...metadata,
      backupCodes: metadata.backupCodes.map((candidate) =>
        candidate.hash === entry.hash ? { ...candidate, usedAt: Date.now() } : candidate
      )
    };
    await this.store.createOrUpdateMfaMethod({
      ...method,
      metadata: updated,
      updatedAt: Date.now()
    });
    return { success: true, method, usedBackupCode: true };
  }

  private parseTotpMetadata(method: MfaMethodRecord): TotpMetadata | null {
    if (!method.metadata) {
      return null;
    }
    return method.metadata as TotpMetadata;
  }

  private decryptTotpSecret(method: MfaMethodRecord, metadata: TotpMetadata | null): string | null {
    if (!metadata?.encryption) {
      return null;
    }
    try {
      return this.vault.decrypt(metadata.encryption);
    } catch (error) {
      this.logger.error("Failed to decrypt TOTP secret", {
        methodId: method.id,
        userId: method.userId,
        error: error instanceof Error ? error.message : error
      });
      return null;
    }
  }

  private hashBackupCode(code: string): string {
    return createHash("sha256").update(code).digest("hex");
  }
}
