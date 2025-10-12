/**
 * Desktop credential storage adapter that delegates to the host keychain implementation.  Electron
 * builds inject a bridge that talks to Keychain (macOS), Credential Manager (Windows), or
 * libsecret (Linux).  Because these services already provide encryption-at-rest, the adapter limits
 * itself to JSON serialisation and defers security to the underlying OS facility.
 */
import type { SecureCredentialStorage, StoredAuthSession } from "@thortiq/client-core";

export interface KeychainAdapter {
  save(service: string, account: string, value: string): Promise<void>;
  load(service: string, account: string): Promise<string | null>;
  delete(service: string, account: string): Promise<void>;
}

export interface DesktopSecureStorageOptions {
  readonly keychain: KeychainAdapter;
  readonly service?: string;
  readonly account?: string;
}

const DEFAULT_SERVICE = "thortiq/auth";
const DEFAULT_ACCOUNT = "primary";

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

export const createDesktopSecureCredentialStorage = (options: DesktopSecureStorageOptions): SecureCredentialStorage => {
  const keychain = options.keychain;
  if (!keychain) {
    throw new Error("Desktop keychain bridge is required");
  }
  const service = options.service ?? DEFAULT_SERVICE;
  const account = options.account ?? DEFAULT_ACCOUNT;

  return {
    async load(): Promise<StoredAuthSession | null> {
      const raw = await keychain.load(service, account);
      return deserialize(raw);
    },
    async save(session: StoredAuthSession): Promise<void> {
      const payload = serialize(session);
      await keychain.save(service, account, payload);
    },
    async clear(): Promise<void> {
      await keychain.delete(service, account);
    }
  } satisfies SecureCredentialStorage;
};
