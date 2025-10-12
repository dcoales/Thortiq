import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createAuthStore } from "@thortiq/client-core/auth/store";
import { createInMemoryCredentialStorage } from "@thortiq/client-core/auth/storage";
import type { AuthHttpClient } from "@thortiq/client-core/auth/httpClient";

import { AuthProvider, useAuthState } from "../AuthProvider";

const createTestStore = () =>
  createAuthStore({
    httpClient: {
      async loginWithPassword() {
        throw new Error("not implemented");
      },
      async loginWithGoogle() {
        throw new Error("not implemented");
      },
      async refresh() {
        throw new Error("not implemented");
      },
      async registerAccount() {
        return {
          accepted: true,
          verificationExpiresAt: Date.now() + 60_000,
          resendAvailableAt: Date.now() + 30_000
        };
      },
      async verifyRegistration() {
        throw new Error("not implemented");
      },
      async resendRegistration() {
        return {
          accepted: true,
          verificationExpiresAt: Date.now() + 60_000,
          resendAvailableAt: Date.now() + 30_000
        };
      },
      async logout() {},
      async logoutAll() {},
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
      }
    } satisfies AuthHttpClient,
    credentialStorage: createInMemoryCredentialStorage()
  });

const StateProbe = () => {
  const state = useAuthState();
  return <div data-testid="auth-status">{state.status}</div>;
};

describe("AuthProvider", () => {
  it("provides auth state to consumers", async () => {
    const store = createTestStore();
    await store.ready;
    render(
      <AuthProvider store={store}>
        <StateProbe />
      </AuthProvider>
    );
    const element = await screen.findByTestId("auth-status");
    expect(element.textContent).toBe("unauthenticated");
  });
});
