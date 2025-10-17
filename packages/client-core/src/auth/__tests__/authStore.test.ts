import { describe, expect, it } from "vitest";

import { createAuthStore } from "../store";
import { createInMemoryCredentialStorage } from "../storage";
import type { AuthState, LoginSuccessResult, StoredAuthSession } from "../storeTypes";

import { AuthHttpError, type AuthHttpClient } from "../httpClient";

const sampleLoginSuccess = (): LoginSuccessResult => ({
  user: {
    id: "user-1",
    email: "user@example.com",
    emailVerified: true,
    displayName: "User",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
    locale: null
  },
  tokens: {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000
  },
  refreshExpiresAt: Date.now() + 3_600_000,
  syncToken: "user-1:sync-token",
  sessionId: "session-1",
  deviceId: "device-1",
  trustedDevice: true,
  mfaCompleted: true
});

const createHttpClientStub = (overrides: Partial<AuthHttpClient>): AuthHttpClient => ({
  async loginWithPassword() {
    throw new Error("Unexpected call");
  },
  async loginWithGoogle() {
    throw new Error("Unexpected call");
  },
  async refresh() {
    throw new Error("Unexpected call");
  },
  async registerAccount() {
    return {
      accepted: true,
      verificationExpiresAt: Date.now() + 60_000,
      resendAvailableAt: Date.now() + 30_000
    };
  },
  async verifyRegistration() {
    throw new Error("Unexpected call");
  },
  async resendRegistration() {
    return {
      accepted: true,
      verificationExpiresAt: Date.now() + 60_000,
      resendAvailableAt: Date.now() + 30_000
    };
  },
  async logout() {
    // noop
  },
  async logoutAll() {
    // noop
  },
  async requestPasswordReset() {
    return { accepted: true };
  },
  async submitPasswordReset() {
    return { success: true };
  },
  async listSessions() {
    return { sessions: [] };
  },
  async revokeSession() {
    // noop
  },
  ...overrides
});

describe("createAuthStore", () => {
  it("starts unauthenticated when no cached session exists", async () => {
    const store = createAuthStore({
      httpClient: createHttpClientStub({}),
      credentialStorage: createInMemoryCredentialStorage()
    });
    await store.ready;
    const state = store.getState();
    expect(state.status).toBe("unauthenticated");
  });

  it("enters authenticated state after successful login and persists session", async () => {
    const storage = createInMemoryCredentialStorage();
    const loginResult = sampleLoginSuccess();
    const httpClient = createHttpClientStub({
      async loginWithPassword() {
        return loginResult;
      }
    });
    const store = createAuthStore({ httpClient, credentialStorage: storage, defaultRememberDevice: true });
    await store.ready;
    await store.loginWithPassword({
      identifier: "user@example.com",
      password: "Password123!",
      rememberDevice: true,
      deviceDisplayName: "Browser",
      devicePlatform: "web"
    });
    const state = store.getState();
    expect(state.status).toBe("authenticated");
    if (state.status !== "authenticated") {
      throw new Error("Store not authenticated");
    }
    expect(state.session.user.id).toBe("user-1");
    expect(state.session.syncToken).toBe("user-1:sync-token");
    const persisted = await storage.load();
    expect(persisted?.sessionId).toBe("session-1");
    expect(persisted?.syncToken).toBe("user-1:sync-token");
  });

  it("handles MFA-required response", async () => {
    const httpClient = createHttpClientStub({
      async loginWithPassword() {
        return {
          challenge: {
            identifier: "user@example.com",
            deviceDisplayName: "Browser",
            devicePlatform: "web",
            methods: [
              {
                id: "totp-1",
                type: "totp",
                label: "Authenticator"
              }
            ]
          }
        };
      }
    });
    const store = createAuthStore({ httpClient, credentialStorage: createInMemoryCredentialStorage() });
    await store.ready;
    await store.loginWithPassword({
      identifier: "user@example.com",
      password: "Password123!",
      rememberDevice: true,
      deviceDisplayName: "Browser",
      devicePlatform: "web"
    });
    const state = store.getState();
    expect(state.status).toBe("mfa_required");
    if (state.status !== "mfa_required") {
      throw new Error("Store not in MFA challenge state");
    }
    expect(state.challenge.methods.length).toBe(1);
  });

  it("marks session offline when refresh encounters a network error", async () => {
    const storage = createInMemoryCredentialStorage();
    const loginResult = sampleLoginSuccess();
    const httpClient = createHttpClientStub({
      async loginWithPassword() {
        return loginResult;
      },
      async refresh() {
        throw new AuthHttpError("Network down", 0, "network_error");
      }
    });
    const store = createAuthStore({ httpClient, credentialStorage: storage });
    await store.ready;
    await store.loginWithPassword({
      identifier: "user@example.com",
      password: "Password123!",
      rememberDevice: true,
      deviceDisplayName: "Browser",
      devicePlatform: "web"
    });
    await store.refreshTokens({ force: true }).catch(() => {
      // swallow expected error
    });
    const state = store.getState() as AuthState;
    expect(state.status).toBe("authenticated");
    if (state.status !== "authenticated") {
      throw new Error("Store not authenticated");
    }
    expect(state.session.offline).toBe(true);
    expect(state.session.syncToken).toBe("user-1:sync-token");
  });

  it("restores cached session on bootstrap", async () => {
    const storage = createInMemoryCredentialStorage();
  const cached: StoredAuthSession = {
    sessionId: "session-cached",
    user: sampleLoginSuccess().user,
    tokens: sampleLoginSuccess().tokens,
    refreshExpiresAt: Date.now() + 3_600_000,
    syncToken: "cached-sync-token",
    deviceId: "device-1",
    deviceDisplayName: "Browser",
    devicePlatform: "web",
    rememberDevice: true,
    trustedDevice: true,
      mfaCompleted: true,
      cachedAt: Date.now()
    };
    await storage.save(cached);
    const store = createAuthStore({
      httpClient: createHttpClientStub({
        async refresh() {
          return {
            tokens: sampleLoginSuccess().tokens,
            refreshExpiresAt: Date.now() + 3_600_000,
            sessionId: "session-cached",
            syncToken: "refreshed-sync-token"
          };
        }
      }),
      credentialStorage: storage
    });
    await store.ready;
    const state = store.getState();
    expect(state.status).toBe("authenticated");
    if (state.status !== "authenticated") {
      throw new Error("Store not authenticated");
    }
    expect(state.session.sessionId).toBe("session-cached");
    expect(state.session.syncToken).toBe("refreshed-sync-token");
  });

  it("enters registration pending state after requesting signup", async () => {
    const httpClient = createHttpClientStub({});
    const store = createAuthStore({ httpClient, credentialStorage: createInMemoryCredentialStorage() });
    await store.ready;
    await store.registerAccount({
      identifier: "new-user@example.com",
      password: "StrongPassword123!",
      rememberDevice: false,
      deviceDisplayName: "Browser",
      devicePlatform: "web",
      consents: {
        termsAccepted: true,
        privacyAccepted: true
      }
    });
    const state = store.getState();
    expect(state.status).toBe("registration_pending");
    if (state.status !== "registration_pending") {
      throw new Error("Store not in registration pending state");
    }
    expect(state.identifier).toBe("new-user@example.com");
  });
});
