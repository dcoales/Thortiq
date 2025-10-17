/**
 * Browser credential storage adapter that keeps refresh tokens encrypted-at-rest using Web Crypto.
 * The encryption key is generated via `crypto.subtle.generateKey` and persisted using
 * `localStorage` so that refresh tokens survive reloads when a device is marked as trusted.
 */
import type { SecureCredentialStorage, StoredAuthSession } from "@thortiq/client-core";

interface WebSecureStorageOptions {
  readonly keyStorageKey?: string;
  readonly sessionStorageKey?: string;
  readonly crypto?: Crypto;
  readonly storage?: Storage;
}

const DEFAULT_KEY_KEY = "thortiq::auth::key";
const DEFAULT_SESSION_KEY = "thortiq::auth::session";
const AES_ALGORITHM = { name: "AES-GCM", length: 256 } as const;
const IV_LENGTH = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const base64Encode = (payload: Uint8Array): string => {
  if (typeof btoa === "function") {
    let binary = "";
    payload.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }
  return Buffer.from(payload).toString("base64");
};

const base64Decode = (value: string): Uint8Array => {
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(value, "base64"));
};

const readKeyMaterial = (storage: Storage, key: string): Uint8Array | null => {
  const stored = storage.getItem(key);
  if (!stored) {
    return null;
  }
  try {
    return base64Decode(stored);
  } catch (_error) {
    storage.removeItem(key);
    return null;
  }
};

const ensureCrypto = (crypto: Crypto | undefined): Crypto => {
  const instance = crypto ?? globalThis.crypto;
  if (!instance || !instance.subtle) {
    throw new Error("Web Crypto API is unavailable");
  }
  return instance;
};

const importOrCreateKey = async (options: { crypto: Crypto; storage: Storage; keyKey: string }): Promise<CryptoKey> => {
  const { crypto, storage, keyKey } = options;
  const subtle = crypto.subtle;
  const existing = readKeyMaterial(storage, keyKey);
  if (existing) {
    return await subtle.importKey("raw", existing, AES_ALGORITHM, true, ["encrypt", "decrypt"]);
  }
  const key = await subtle.generateKey(AES_ALGORITHM, true, ["encrypt", "decrypt"]);
  const exported = await subtle.exportKey("raw", key);
  storage.setItem(keyKey, base64Encode(new Uint8Array(exported)));
  return key;
};

const serialize = (session: StoredAuthSession): Uint8Array => {
  const payload = JSON.stringify(session);
  return encoder.encode(payload);
};

const deserialize = (payload: Uint8Array): StoredAuthSession => {
  const json = decoder.decode(payload);
  const parsed = JSON.parse(json) as StoredAuthSession;
  return parsed;
};

export const createWebSecureCredentialStorage = (options: WebSecureStorageOptions = {}): SecureCredentialStorage => {
  const storage = options.storage ?? globalThis.localStorage;
  if (!storage) {
    throw new Error("localStorage is unavailable");
  }
  const crypto = ensureCrypto(options.crypto);
  const keyKey = options.keyStorageKey ?? DEFAULT_KEY_KEY;
  const sessionKey = options.sessionStorageKey ?? DEFAULT_SESSION_KEY;

  const loadEncryptedBytes = (): Uint8Array | null => {
    const value = storage.getItem(sessionKey);
    if (!value) {
      return null;
    }
    try {
      return base64Decode(value);
    } catch (_error) {
      storage.removeItem(sessionKey);
      return null;
    }
  };

  return {
    async load(): Promise<StoredAuthSession | null> {
      const encrypted = loadEncryptedBytes();
      if (!encrypted) {
        return null;
      }
      try {
        const key = await importOrCreateKey({ crypto, storage, keyKey });
        const iv = encrypted.slice(0, IV_LENGTH);
        const ciphertext = encrypted.slice(IV_LENGTH);
        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
        return deserialize(new Uint8Array(decrypted));
      } catch (_error) {
        storage.removeItem(sessionKey);
        return null;
      }
    },
    async save(session: StoredAuthSession): Promise<void> {
      const key = await importOrCreateKey({ crypto, storage, keyKey });
      const data = serialize(session);
      const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
      const combined = new Uint8Array(iv.length + ciphertext.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(ciphertext), iv.length);
      storage.setItem(sessionKey, base64Encode(combined));
    },
    async clear(): Promise<void> {
      storage.removeItem(sessionKey);
    }
  } satisfies SecureCredentialStorage;
};
