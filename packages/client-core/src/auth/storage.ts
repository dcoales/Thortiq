/**
 * Defines the platform-agnostic secure credential storage contract.  Each platform provides its
 * own implementation (e.g. Web Crypto + IndexedDB for browsers, Keychain/Keystore for native
 * shells).  The auth store only depends on this abstraction to persist refresh credentials when a
 * device is marked as trusted.
 */
import type { StoredAuthSession } from "./storeTypes";

export interface SecureCredentialStorage {
  load(): Promise<StoredAuthSession | null>;
  save(session: StoredAuthSession): Promise<void>;
  clear(): Promise<void>;
}

export const createInMemoryCredentialStorage = (): SecureCredentialStorage => {
  let cached: StoredAuthSession | null = null;
  return {
    async load(): Promise<StoredAuthSession | null> {
      return cached ? { ...cached } : null;
    },
    async save(session: StoredAuthSession): Promise<void> {
      cached = { ...session };
    },
    async clear(): Promise<void> {
      cached = null;
    }
  } satisfies SecureCredentialStorage;
};
