/**
 * Mobile credential storage adapter that composes with platform-provided secure stores (Keychain,
 * Keystore, etc.).  React Native builds pass an adapter backed by `expo-secure-store` or similar,
 * allowing refresh tokens to live in OS-protected vaults while the shared auth store deals with
 * serialisation.
 */
import type { SecureCredentialStorage, StoredAuthSession } from "@thortiq/client-core";

export interface SecureStoreAdapter {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  deleteItem(key: string): Promise<void>;
}

export interface MobileSecureStorageOptions {
  readonly secureStore: SecureStoreAdapter;
  readonly key?: string;
}

const DEFAULT_KEY = "thortiq::auth::session";

const serialize = (session: StoredAuthSession): string => JSON.stringify(session);

const deserialize = (value: string | null): StoredAuthSession | null => {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as StoredAuthSession;
  } catch (_error) {
    return null;
  }
};

export const createMobileSecureCredentialStorage = (options: MobileSecureStorageOptions): SecureCredentialStorage => {
  if (!options.secureStore) {
    throw new Error("Mobile secure store adapter is required");
  }
  const key = options.key ?? DEFAULT_KEY;

  return {
    async load(): Promise<StoredAuthSession | null> {
      const raw = await options.secureStore.getItem(key);
      return deserialize(raw);
    },
    async save(session: StoredAuthSession): Promise<void> {
      await options.secureStore.setItem(key, serialize(session));
    },
    async clear(): Promise<void> {
      await options.secureStore.deleteItem(key);
    }
  } satisfies SecureCredentialStorage;
};
