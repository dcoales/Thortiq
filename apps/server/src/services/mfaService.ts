import { createHash, randomBytes } from "node:crypto";

import { authenticator } from "otplib";

import type { MfaMethodRecord } from "@thortiq/client-core";

import type { Logger } from "../logger";
import type { IdentityStore } from "../identity/types";

interface BackupCodeEntry {
  readonly hash: string;
  readonly usedAt?: number | null;
}

interface TotpMetadata extends Readonly<Record<string, unknown>> {
  readonly backupCodes?: ReadonlyArray<BackupCodeEntry>;
  readonly digits?: number;
  readonly period?: number;
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

  constructor(options: MfaServiceOptions) {
    this.store = options.identityStore;
    this.logger = options.logger;
    this.window = options.window ?? 1;
  }

  async listActiveMethods(userId: string): Promise<ReadonlyArray<MfaMethodRecord>> {
    return this.store.getMfaMethodsByUser(userId);
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

  async generateTotpSecret(userId: string, label: string): Promise<{ secret: string; otpauth: string; backupCodes: ReadonlyArray<string> }> {
    const secret = authenticator.generateSecret();
    const backupCodes = this.generateBackupCodes();
    const encodedBackup = backupCodes.map((code) => ({ hash: this.hashBackupCode(code), usedAt: null }));
    const metadata: TotpMetadata = {
      backupCodes: encodedBackup,
      digits: authenticator.options.digits,
      period: authenticator.options.step
    };

    const method: MfaMethodRecord = {
      id: `totp-${userId}-${Date.now()}`,
      userId,
      type: "totp",
      secret,
      label,
      metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      verifiedAt: null,
      disabledAt: null
    };

    await this.store.createOrUpdateMfaMethod(method);

    const otpauth = authenticator.keyuri(label, "Thortiq", secret);
    return { secret, otpauth, backupCodes };
  }

  generateBackupCodes(count: number = 10): ReadonlyArray<string> {
    const codes: string[] = [];
    for (let index = 0; index < count; index += 1) {
      codes.push(randomBytes(5).toString("hex"));
    }
    return codes;
  }

  async verifyTotpMethod(method: MfaMethodRecord, code: string): Promise<VerificationResult> {
    const metadata = this.parseTotpMetadata(method);
    authenticator.options = {
      digits: metadata?.digits ?? 6,
      step: metadata?.period ?? 30,
      window: this.window
    };
    if (!method.secret) {
      return { success: false };
    }
    const verified = authenticator.check(code, method.secret);
    if (verified) {
      if (!method.verifiedAt) {
        await this.store.createOrUpdateMfaMethod({
          ...method,
          verifiedAt: Date.now(),
          updatedAt: Date.now()
        });
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

  private hashBackupCode(code: string): string {
    return createHash("sha256").update(code).digest("hex");
  }
}
