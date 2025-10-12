import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createAuthStore } from "@thortiq/client-core/auth/store";
import { createInMemoryCredentialStorage } from "@thortiq/client-core/auth/storage";
import type { AuthHttpClient } from "@thortiq/client-core/auth/httpClient";

import { AccountRecoveryRequestForm } from "../components/AccountRecoveryRequestForm";
import { PasswordResetForm } from "../components/PasswordResetForm";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { AuthProvider } from "../AuthProvider";

const baseHttpClient: AuthHttpClient = {
  async loginWithPassword() {
    throw new Error("not implemented");
  },
  async loginWithGoogle() {
    throw new Error("not implemented");
  },
  async refresh() {
    throw new Error("not implemented");
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
    return;
  }
};

describe("auth components", () => {
  it("submits account recovery requests", async () => {
    const requestSpy = vi.fn().mockResolvedValue({ accepted: true });
    const store = createAuthStore({
      httpClient: { ...baseHttpClient, requestPasswordReset: requestSpy },
      credentialStorage: createInMemoryCredentialStorage()
    });
    await store.ready;
    render(
      <AuthProvider store={store}>
        <AccountRecoveryRequestForm />
      </AuthProvider>
    );
    const input = await screen.findByLabelText(/email/i);
    fireEvent.change(input, { target: { value: "person@example.com" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(requestSpy).toHaveBeenCalledWith({ identifier: "person@example.com" }));
    expect(screen.getByRole("status").textContent).toContain("email recovery");
  });

  it("submits password reset", async () => {
    const resetSpy = vi.fn().mockResolvedValue({ success: true });
    const store = createAuthStore({
      httpClient: { ...baseHttpClient, submitPasswordReset: resetSpy },
      credentialStorage: createInMemoryCredentialStorage()
    });
    await store.ready;
    render(
      <AuthProvider store={store}>
        <PasswordResetForm token="token-123" />
      </AuthProvider>
    );
    const newPassword = await screen.findByLabelText(/new password/i);
    const confirmPassword = await screen.findByLabelText(/confirm password/i);
    fireEvent.change(newPassword, { target: { value: "Password123!" } });
    fireEvent.change(confirmPassword, { target: { value: "Password123!" } });
    fireEvent.submit(screen.getByRole("button", { name: /update password/i }).closest("form") as HTMLFormElement);
    await waitFor(() => expect(resetSpy).toHaveBeenCalled());
  });

  it("renders google button and triggers click handler", async () => {
    const handler = vi.fn();
    render(<GoogleSignInButton onClick={handler} />);
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    await waitFor(() => expect(handler).toHaveBeenCalled());
  });
});
