import { useEffect, useState } from "react";

import {
  AccountRecoveryRequestForm,
  AuthErrorNotice,
  GoogleSignInButton,
  useAuthActions,
  useAuthError,
  useAuthIsAuthenticating,
  useAuthIsRegistering,
  useAuthRegistrationPending,
  useAuthRememberDevicePreference
} from "@thortiq/client-react";

import type { PasswordLoginInput, RegistrationRequestInput } from "@thortiq/client-core";

import { getDeviceDescriptor } from "./device";
import { requestGoogleIdToken } from "./google";

type PanelMode = "signin" | "signup" | "recovery";

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

const createRegistrationInput = (
  identifier: string,
  password: string,
  rememberDevice: boolean,
  consents: RegistrationRequestInput["consents"]
): RegistrationRequestInput => {
  const descriptor = getDeviceDescriptor();
  return {
    identifier,
    password,
    rememberDevice,
    deviceId: descriptor.deviceId,
    deviceDisplayName: descriptor.displayName,
    devicePlatform: descriptor.platform,
    consents
  } satisfies RegistrationRequestInput;
};

export const LoginView = () => {
  const {
    loginWithPassword,
    loginWithGoogle,
    registerAccount,
    resendRegistration,
    cancelRegistration,
    updateRememberDevice
  } = useAuthActions();
  const rememberPreference = useAuthRememberDevicePreference();
  const registrationPending = useAuthRegistrationPending();
  const isAuthenticating = useAuthIsAuthenticating();
  const isRegistering = useAuthIsRegistering();
  const authError = useAuthError();

  const [mode, setMode] = useState<PanelMode>("signin");
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInRemember, setSignInRemember] = useState<boolean>(rememberPreference);
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpRemember, setSignUpRemember] = useState<boolean>(rememberPreference);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [signInSubmitting, setSignInSubmitting] = useState(false);
  const [signUpSubmitting, setSignUpSubmitting] = useState(false);
  const [resendSubmitting, setResendSubmitting] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  useEffect(() => {
    setSignInRemember(rememberPreference);
    setSignUpRemember(rememberPreference);
  }, [rememberPreference]);

  useEffect(() => {
    if (registrationPending || isRegistering) {
      setMode("signup");
    }
  }, [registrationPending, isRegistering]);

  const handleSignInSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (!signInEmail || !signInPassword) {
      return;
    }
    setSignInSubmitting(true);
    try {
      await updateRememberDevice(signInRemember);
      await loginWithPassword(createLoginInput(signInEmail.trim(), signInPassword, signInRemember));
    } finally {
      setSignInSubmitting(false);
    }
  };

  const handleSignUpSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (!signUpEmail || !signUpPassword || !acceptTerms || !acceptPrivacy) {
      return;
    }
    setSignUpSubmitting(true);
    try {
      await updateRememberDevice(signUpRemember);
      await registerAccount(
        createRegistrationInput(signUpEmail.trim(), signUpPassword, signUpRemember, {
          termsAccepted: acceptTerms,
          privacyAccepted: acceptPrivacy,
          marketingOptIn
        })
      );
    } finally {
      setSignUpSubmitting(false);
    }
  };

  const handleGoogleSignIn = async (remember: boolean) => {
    setGoogleError(null);
    try {
      const token = await requestGoogleIdToken();
      const descriptor = getDeviceDescriptor();
      await loginWithGoogle({
        idToken: token,
        rememberDevice: remember,
        deviceId: descriptor.deviceId,
        deviceDisplayName: descriptor.displayName,
        devicePlatform: descriptor.platform
      });
    } catch (error) {
      setGoogleError(error instanceof Error ? error.message : "Google sign-in failed");
    }
  };

  const handleResend = async () => {
    if (!registrationPending) {
      return;
    }
    setResendSubmitting(true);
    try {
      await resendRegistration({ identifier: registrationPending.identifier });
    } finally {
      setResendSubmitting(false);
    }
  };

  const busySigningIn = signInSubmitting || isAuthenticating;
  const busySigningUp = signUpSubmitting || isRegistering;
  const busyResend = resendSubmitting || isRegistering;

  if (registrationPending) {
    return (
      <div className="auth-panel">
        <h1>Check your email</h1>
        <p>
          We sent a verification link to <strong>{registrationPending.identifier}</strong>. Open the link on this device to finish setting up your
          account.
        </p>
        <AuthErrorNotice error={registrationPending.error} />
        <div className="auth-actions">
          <button type="button" onClick={handleResend} disabled={busyResend}>
            {busyResend ? "Sending…" : "Resend email"}
          </button>
          <button type="button" className="link-button" onClick={() => cancelRegistration()}>
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-panel">
      <div className="auth-tablist" role="tablist" aria-label="Authentication modes">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signin"}
          className={mode === "signin" ? "active" : ""}
          onClick={() => {
            setMode("signin");
            cancelRegistration();
          }}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signup"}
          className={mode === "signup" ? "active" : ""}
          onClick={() => setMode("signup")}
        >
          Create account
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "recovery"}
          className={mode === "recovery" ? "active" : ""}
          onClick={() => setMode("recovery")}
        >
          Forgot password
        </button>
      </div>

      {mode === "signin" && (
        <>
          <h1>Sign in</h1>
          <form onSubmit={handleSignInSubmit} className="auth-form" noValidate>
            <label htmlFor="login-identifier">Email</label>
            <input
              id="login-identifier"
              type="email"
              autoComplete="email"
              value={signInEmail}
              onChange={(event) => setSignInEmail(event.target.value)}
              disabled={busySigningIn}
              required
            />
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={signInPassword}
              onChange={(event) => setSignInPassword(event.target.value)}
              disabled={busySigningIn}
              required
            />
            <label className="remember-device">
              <input
                type="checkbox"
                checked={signInRemember}
                onChange={(event) => setSignInRemember(event.target.checked)}
                disabled={busySigningIn}
              />
              Remember this device
            </label>
            <div className="auth-actions">
              <button type="submit" disabled={busySigningIn}>
                {busySigningIn ? "Signing in…" : "Sign in"}
              </button>
            </div>
            <AuthErrorNotice error={authError} />
          </form>
          <div className="auth-divider" aria-hidden="true">
            <span />
            <span>or</span>
            <span />
          </div>
          <GoogleSignInButton onClick={() => handleGoogleSignIn(signInRemember)} disabled={busySigningIn} />
          {googleError ? <div role="alert" data-error="google">{googleError}</div> : null}
        </>
      )}

      {mode === "signup" && (
        <>
          <h1>Create account</h1>
          <form onSubmit={handleSignUpSubmit} className="auth-form" noValidate>
            <label htmlFor="signup-identifier">Email</label>
            <input
              id="signup-identifier"
              type="email"
              autoComplete="email"
              value={signUpEmail}
              onChange={(event) => setSignUpEmail(event.target.value)}
              disabled={busySigningUp}
              required
            />
            <label htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              value={signUpPassword}
              onChange={(event) => setSignUpPassword(event.target.value)}
              disabled={busySigningUp}
              required
            />
            <label className="remember-device">
              <input
                type="checkbox"
                checked={signUpRemember}
                onChange={(event) => setSignUpRemember(event.target.checked)}
                disabled={busySigningUp}
              />
              Remember this device
            </label>
            <fieldset className="consent-group" disabled={busySigningUp}>
              <legend>Consents</legend>
              <label>
                <input type="checkbox" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} required />
                I agree to the Terms of Service
              </label>
              <label>
                <input type="checkbox" checked={acceptPrivacy} onChange={(event) => setAcceptPrivacy(event.target.checked)} required />
                I have read and accept the Privacy Policy
              </label>
              <label>
                <input type="checkbox" checked={marketingOptIn} onChange={(event) => setMarketingOptIn(event.target.checked)} />
                Send me occasional product updates
              </label>
            </fieldset>
            <div className="auth-actions">
              <button type="submit" disabled={busySigningUp}>
                {busySigningUp ? "Creating account…" : "Create account"}
              </button>
            </div>
            <AuthErrorNotice error={authError} />
          </form>
          <div className="auth-divider" aria-hidden="true">
            <span />
            <span>or</span>
            <span />
          </div>
          <GoogleSignInButton onClick={() => handleGoogleSignIn(signUpRemember)} disabled={busySigningUp} />
          {googleError ? <div role="alert" data-error="google">{googleError}</div> : null}
        </>
      )}

      {mode === "recovery" && (
        <div className="recovery-panel">
          <h1>Reset your password</h1>
          <AccountRecoveryRequestForm initialIdentifier={signInEmail || signUpEmail} onSubmitted={() => setMode("signin")} />
        </div>
      )}
    </div>
  );
};
