import { describe, expect, it } from "vitest";

import type { StoredAuthSession } from "@thortiq/client-core";

import { createMobileSecureCredentialStorage, type SecureStoreAdapter } from "../secureStorage";

const createStubSecureStore = (): SecureStoreAdapter & { store: Map<string, string> } => {
  const store = new Map<string, string>();
  return {
    store,
    async setItem(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async getItem(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async deleteItem(key: string): Promise<void> {
      store.delete(key);
    }
  } satisfies SecureStoreAdapter & { store: Map<string, string> };
};

const session: StoredAuthSession = {
  sessionId: "mobile-session",
  user: {
    id: "mobile-user",
    email: "mobile@example.com",
    emailVerified: true,
    displayName: "Mobile User",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
    locale: null
  },
  tokens: {
    accessToken: "mobile-access",
    refreshToken: "mobile-refresh",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000
  },
  refreshExpiresAt: Date.now() + 3600_000,
  deviceId: "mobile-device",
  deviceDisplayName: "Phone",
  devicePlatform: "ios",
  rememberDevice: true,
  trustedDevice: true,
  mfaCompleted: true,
  cachedAt: Date.now()
};

describe("createMobileSecureCredentialStorage", () => {
  it("persists sessions via secure store adapter", async () => {
    const secureStore = createStubSecureStore();
    const storage = createMobileSecureCredentialStorage({ secureStore, key: "mobile" });

    await storage.save(session);
    expect(secureStore.store.has("mobile")).toBe(true);

    const loaded = await storage.load();
    expect(loaded).toEqual(session);
  });

  it("clears sessions", async () => {
    const secureStore = createStubSecureStore();
    const storage = createMobileSecureCredentialStorage({ secureStore, key: "mobile2" });

    await storage.save(session);
    await storage.clear();

    expect(await storage.load()).toBeNull();
  });

  it("handles invalid payloads gracefully", async () => {
    const secureStore = createStubSecureStore();
    const storage = createMobileSecureCredentialStorage({ secureStore, key: "mobile3" });

    await secureStore.setItem("mobile3", "not-json");
    expect(await storage.load()).toBeNull();
  });
});
