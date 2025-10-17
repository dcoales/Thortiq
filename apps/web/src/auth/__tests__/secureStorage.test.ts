import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import type { StoredAuthSession } from "@thortiq/client-core";

import { createWebSecureCredentialStorage } from "../secureStorage";

const createSampleSession = (): StoredAuthSession => ({
  sessionId: "session-1",
  user: {
    id: "user-1",
    email: "web@example.com",
    emailVerified: true,
    displayName: "Web User",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
    locale: null
  },
  tokens: {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    issuedAt: Date.now() - 1_000,
    expiresAt: Date.now() + 60_000
  },
  refreshExpiresAt: Date.now() + 3600_000,
  syncToken: "web-sync-token",
  deviceId: "device-1",
  deviceDisplayName: "Browser",
  devicePlatform: "web",
  rememberDevice: true,
  trustedDevice: true,
  mfaCompleted: true,
  cachedAt: Date.now()
});

describe("createWebSecureCredentialStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists and restores sessions using AES-GCM encryption", async () => {
    const storage = createWebSecureCredentialStorage({
      crypto: webcrypto as unknown as Crypto,
      storage: localStorage,
      keyStorageKey: "test:key",
      sessionStorageKey: "test:session"
    });
    const session = createSampleSession();

    await storage.save(session);
    const loaded = await storage.load();

    expect(loaded).toEqual(session);
    expect(localStorage.getItem("test:session")).toBeTypeOf("string");
  });

  it("returns null when ciphertext is tampered", async () => {
    const storage = createWebSecureCredentialStorage({
      crypto: webcrypto as unknown as Crypto,
      storage: localStorage,
      keyStorageKey: "test:key2",
      sessionStorageKey: "test:session2"
    });

    const session = createSampleSession();
    await storage.save(session);

    const stored = localStorage.getItem("test:session2");
    expect(stored).toBeTypeOf("string");
    localStorage.setItem("test:session2", `${stored}corruption`);

    const loaded = await storage.load();
    expect(loaded).toBeNull();
  });

  it("clears stored credentials", async () => {
    const storage = createWebSecureCredentialStorage({
      crypto: webcrypto as unknown as Crypto,
      storage: localStorage,
      keyStorageKey: "test:key3",
      sessionStorageKey: "test:session3"
    });

    const session = createSampleSession();
    await storage.save(session);
    await storage.clear();

    expect(await storage.load()).toBeNull();
    expect(localStorage.getItem("test:session3")).toBeNull();
  });
});
