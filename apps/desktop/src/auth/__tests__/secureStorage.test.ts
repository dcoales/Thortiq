import { describe, expect, it } from "vitest";

import type { StoredAuthSession } from "@thortiq/client-core";

import { createDesktopSecureCredentialStorage, type KeychainAdapter } from "../secureStorage";

const createStubKeychain = (): KeychainAdapter & { store: Map<string, string> } => {
  const store = new Map<string, string>();
  return {
    store,
    async save(service: string, account: string, value: string): Promise<void> {
      store.set(`${service}:${account}`, value);
    },
    async load(service: string, account: string): Promise<string | null> {
      return store.get(`${service}:${account}`) ?? null;
    },
    async delete(service: string, account: string): Promise<void> {
      store.delete(`${service}:${account}`);
    }
  } satisfies KeychainAdapter & { store: Map<string, string> };
};

const sampleSession: StoredAuthSession = {
  sessionId: "desktop-session",
  user: {
    id: "desktop-user",
    email: "desktop@example.com",
    emailVerified: true,
    displayName: "Desktop User",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
    locale: null
  },
  tokens: {
    accessToken: "desktop-access",
    refreshToken: "desktop-refresh",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000
  },
  refreshExpiresAt: Date.now() + 3600_000,
  deviceId: "desktop-device",
  deviceDisplayName: "Desktop",
  devicePlatform: "desktop",
  rememberDevice: true,
  trustedDevice: true,
  mfaCompleted: true,
  cachedAt: Date.now()
};

describe("createDesktopSecureCredentialStorage", () => {
  it("persists sessions via the keychain adapter", async () => {
    const keychain = createStubKeychain();
    const storage = createDesktopSecureCredentialStorage({ keychain, service: "test-service", account: "primary" });

    await storage.save(sampleSession);
    expect(keychain.store.size).toBe(1);

    const loaded = await storage.load();
    expect(loaded).toEqual(sampleSession);
  });

  it("clears stored sessions", async () => {
    const keychain = createStubKeychain();
    const storage = createDesktopSecureCredentialStorage({ keychain });

    await storage.save(sampleSession);
    expect(await storage.load()).not.toBeNull();

    await storage.clear();
    expect(await storage.load()).toBeNull();
  });

  it("handles corrupt payloads by returning null", async () => {
    const keychain = createStubKeychain();
    const storage = createDesktopSecureCredentialStorage({ keychain, service: "service", account: "account" });

    await keychain.save("service", "account", "not-json");
    expect(await storage.load()).toBeNull();
  });
});
