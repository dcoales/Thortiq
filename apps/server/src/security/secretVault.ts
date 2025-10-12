import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Symmetric encryption helper for protecting MFA secrets at rest. The vault derives a stable
 * 256-bit key from the configured secret and keeps the API intentionally small so callers avoid
 * leaking implementation details outside this module.
 */
export interface EncryptedSecret {
  readonly algorithm: "aes-256-gcm";
  readonly iv: string;
  readonly ciphertext: string;
  readonly authTag: string;
}

export interface SecretVaultOptions {
  readonly secretKey: string;
}

export class SecretVault {
  private readonly key: Buffer;

  constructor(options: SecretVaultOptions) {
    this.key = createHash("sha256").update(options.secretKey).digest();
  }

  encrypt(plaintext: string): EncryptedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64url"),
      ciphertext: encrypted.toString("base64url"),
      authTag: authTag.toString("base64url")
    };
  }

  decrypt(payload: EncryptedSecret): string {
    if (payload.algorithm !== "aes-256-gcm") {
      throw new Error(`Unsupported encryption algorithm: ${payload.algorithm}`);
    }
    const iv = Buffer.from(payload.iv, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(Buffer.from(payload.authTag, "base64url"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64url")), decipher.final()]);
    return decrypted.toString("utf8");
  }
}

