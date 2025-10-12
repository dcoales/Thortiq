import { useEffect, useState } from "react";

import {
  AccountRecoveryRequestForm,
  AuthErrorNotice,
  GoogleSignInButton,
  useAuthActions,
  useAuthIsAuthenticating,
  useAuthRememberDevicePreference
} from "@thortiq/client-react";

import type { PasswordLoginInput } from "@thortiq/client-core";

import { getDeviceDescriptor } from "./device";
import { requestGoogleIdToken } from "./google";

const createLoginInput = (identifier: string, password: string, rememberDevice: boolean): PasswordLoginInput => {
  const descriptor = getDeviceDescriptor();
  return {
    identifier,
    password,
    rememberDevice,
    deviceId: descriptor.deviceId,
    deviceDisplayName: descriptor.displayName,
    devicePlatform: descriptor.platform
  } satisfies PasswordLoginInput;
};

export const LoginView = () => {
  const { loginWithPassword, loginWithGoogle, updateRememberDevice } = useAuthActions();
  const rememberPreference = useAuthRememberDevicePreference();
  const isAuthenticating = useAuthIsAuthenticating();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberDevice, setRememberDevice] = useState<boolean>(rememberPreference);
  const [submitting, setSubmitting] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  useEffect(() => {
    setRememberDevice(rememberPreference);
  }, [rememberPreference]);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (!identifier || !password) {
      return;
    }
    setSubmitting(true);
    try {
      await updateRememberDevice(rememberDevice);
      await loginWithPassword(createLoginInput(identifier.trim(), password, rememberDevice));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRememberChange: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const next = event.target.checked;
    setRememberDevice(next);
    try {
      await updateRememberDevice(next);
    } catch (error) {
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("Failed to update remember-device preference", error);
      }
    }
  };

  const handleGoogle = async () => {
    setGoogleError(null);
    try {
      const token = await requestGoogleIdToken();
      const descriptor = getDeviceDescriptor();
      await loginWithGoogle({
        idToken: token,
        rememberDevice,
        deviceId: descriptor.deviceId,
        deviceDisplayName: descriptor.displayName,
        devicePlatform: descriptor.platform
      });
    } catch (error) {
      setGoogleError(error instanceof Error ? error.message : "Google sign-in failed");
    }
  };

  return (
    <div className="auth-panel">
      <h1>Sign in</h1>
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <label htmlFor="login-identifier">Email</label>
        <input
          id="login-identifier"
          type="email"
          autoComplete="email"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          disabled={submitting || isAuthenticating}
          required
        />
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={submitting || isAuthenticating}
          required
        />
        <label className="remember-device">
          <input type="checkbox" checked={rememberDevice} onChange={handleRememberChange} disabled={submitting || isAuthenticating} />
          Remember this device
        </label>
        <div className="auth-actions">
          <button type="submit" disabled={submitting || isAuthenticating}>
            {submitting || isAuthenticating ? "Signing in…" : "Sign in"}
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => setShowRecovery((value) => !value)}
            disabled={submitting || isAuthenticating}
          >
            {showRecovery ? "Back to sign in" : "Forgot password?"}
          </button>
        </div>
        <AuthErrorNotice />
      </form>
      <div className="auth-divider" aria-hidden="true">
        <span />
        <span>or</span>
        <span />
      </div>
      <GoogleSignInButton onClick={handleGoogle} disabled={submitting || isAuthenticating} />
      {googleError ? <div role="alert" data-error="google">{googleError}</div> : null}
      {showRecovery ? (
        <div className="recovery-panel">
          <h2>Reset your password</h2>
          <AccountRecoveryRequestForm initialIdentifier={identifier} onSubmitted={() => setShowRecovery(false)} />
        </div>
      ) : null}
    </div>
  );
};
