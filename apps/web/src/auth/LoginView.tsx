import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import {
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
import { FONT_FAMILY_STACK } from "../theme/typography";

type PanelMode = "signin" | "signup" | "recovery";

const styles: Record<string, CSSProperties> = {
  container: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem",
    fontFamily: FONT_FAMILY_STACK,
    position: "relative",
    overflow: "hidden"
  },
  backgroundPattern: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: `
      radial-gradient(circle at 20% 80%, rgba(120, 119, 198, 0.3) 0%, transparent 50%),
      radial-gradient(circle at 80% 20%, rgba(255, 255, 255, 0.1) 0%, transparent 50%),
      radial-gradient(circle at 40% 40%, rgba(120, 119, 198, 0.2) 0%, transparent 50%)
    `,
    pointerEvents: "none"
  },
  authPanel: {
    background: "rgba(255, 255, 255, 0.95)",
    backdropFilter: "blur(20px)",
    borderRadius: "1.5rem",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    width: "100%",
    maxWidth: "400px",
    padding: "2rem",
    position: "relative",
    zIndex: 1
  },
  logo: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "1rem",
    marginBottom: "0"
  },
  logoImage: {
    height: "120px",
    width: "auto"
  },
  logoText: {
    fontSize: "2.5rem",
    fontWeight: 700,
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    margin: 0,
    letterSpacing: "-0.025em"
  },
  tabList: {
    display: "flex",
    background: "rgba(102, 126, 234, 0.1)",
    borderRadius: "0.75rem",
    padding: "0.25rem",
    marginBottom: "2rem",
    gap: "0.25rem"
  },
  tabButton: {
    flex: 1,
    padding: "0.75rem 1rem",
    border: "none",
    background: "transparent",
    borderRadius: "0.5rem",
    fontSize: "0.875rem",
    fontWeight: 500,
    color: "#6b7280",
    cursor: "pointer",
    transition: "all 0.2s ease",
    fontFamily: "inherit"
  },
  tabButtonActive: {
    background: "#667eea",
    color: "#ffffff",
    boxShadow: "0 4px 6px -1px rgba(102, 126, 234, 0.3)"
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 600,
    color: "#111827",
    margin: "0 0 1.5rem 0",
    textAlign: "center"
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "1.25rem"
  },
  label: {
    fontSize: "0.875rem",
    fontWeight: 500,
    color: "#374151",
    marginBottom: "0.5rem",
    display: "block"
  },
  input: {
    width: "100%",
    padding: "0.875rem 1rem",
    border: "1px solid #d1d5db",
    borderRadius: "0.75rem",
    fontSize: "1rem",
    background: "#ffffff",
    transition: "all 0.2s ease",
    fontFamily: "inherit",
    boxSizing: "border-box"
  },
  inputFocus: {
    outline: "none",
    borderColor: "#667eea",
    boxShadow: "0 0 0 3px rgba(102, 126, 234, 0.1)"
  },
  inputDisabled: {
    background: "#f9fafb",
    color: "#9ca3af",
    cursor: "not-allowed"
  },
  rememberDevice: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: "0.875rem",
    color: "#6b7280",
    cursor: "pointer",
    marginTop: "0.5rem"
  },
  rememberDeviceLeft: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem"
  },
  forgotPasswordLink: {
    color: "#667eea",
    textDecoration: "none",
    fontSize: "0.875rem",
    fontWeight: 500,
    cursor: "pointer",
    transition: "color 0.2s ease"
  },
  forgotPasswordLinkHover: {
    color: "#5a67d8"
  },
  checkbox: {
    width: "1rem",
    height: "1rem",
    accentColor: "#667eea"
  },
  consentGroup: {
    border: "1px solid #e5e7eb",
    borderRadius: "0.75rem",
    padding: "1rem",
    background: "#f9fafb"
  },
  consentLegend: {
    fontSize: "0.875rem",
    fontWeight: 500,
    color: "#374151",
    marginBottom: "0.75rem",
    padding: 0
  },
  consentLabel: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.5rem",
    fontSize: "0.875rem",
    color: "#6b7280",
    marginBottom: "0.5rem",
    cursor: "pointer",
    lineHeight: 1.4
  },
  authActions: {
    marginTop: "0.5rem"
  },
  submitButton: {
    width: "100%",
    padding: "0.875rem 1.5rem",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    color: "#ffffff",
    border: "none",
    borderRadius: "0.75rem",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
    fontFamily: "inherit",
    boxShadow: "0 4px 6px -1px rgba(102, 126, 234, 0.3)"
  },
  submitButtonHover: {
    transform: "translateY(-1px)",
    boxShadow: "0 8px 15px -3px rgba(102, 126, 234, 0.4)"
  },
  submitButtonDisabled: {
    background: "#9ca3af",
    cursor: "not-allowed",
    transform: "none",
    boxShadow: "none"
  },
  divider: {
    display: "flex",
    alignItems: "center",
    margin: "1.5rem 0",
    color: "#9ca3af",
    fontSize: "0.875rem"
  },
  dividerLine: {
    flex: 1,
    height: "1px",
    background: "#e5e7eb"
  },
  dividerText: {
    padding: "0 1rem",
    background: "rgba(255, 255, 255, 0.95)",
    fontWeight: 500
  },
  googleButtonContainer: {
    display: "flex",
    justifyContent: "center",
    marginTop: "1rem"
  },
  errorMessage: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#dc2626",
    padding: "0.75rem 1rem",
    borderRadius: "0.75rem",
    fontSize: "0.875rem",
    marginTop: "1rem"
  },
  recoveryPanel: {
    textAlign: "center"
  },
  recoveryForm: {
    display: "flex",
    flexDirection: "column",
    gap: "1.25rem",
    marginTop: "1rem"
  },
  recoveryInput: {
    width: "100%",
    padding: "0.875rem 1rem",
    border: "1px solid #d1d5db",
    borderRadius: "0.75rem",
    fontSize: "1rem",
    background: "#ffffff",
    transition: "all 0.2s ease",
    fontFamily: "inherit",
    boxSizing: "border-box"
  },
  recoveryButton: {
    width: "100%",
    padding: "0.875rem 1.5rem",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    color: "#ffffff",
    border: "none",
    borderRadius: "0.75rem",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
    fontFamily: "inherit",
    boxShadow: "0 4px 6px -1px rgba(102, 126, 234, 0.3)"
  },
  recoveryButtonDisabled: {
    background: "#9ca3af",
    cursor: "not-allowed",
    transform: "none",
    boxShadow: "none"
  },
  recoveryStatus: {
    padding: "0.75rem 1rem",
    borderRadius: "0.75rem",
    fontSize: "0.875rem",
    marginTop: "1rem",
    textAlign: "center"
  },
  recoveryStatusSuccess: {
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    color: "#166534"
  },
  recoveryStatusError: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#dc2626"
  },
  recoveryStatusWarning: {
    background: "#fffbeb",
    border: "1px solid #fed7aa",
    color: "#d97706"
  }
};

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
    updateRememberDevice,
    requestPasswordReset
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
  const [signInSubmitting, setSignInSubmitting] = useState(false);
  const [signUpSubmitting, setSignUpSubmitting] = useState(false);
  const [resendSubmitting, setResendSubmitting] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState(signInEmail || signUpEmail || "");
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState<"idle" | "success" | "error" | "rate_limited" | "captcha_required">("idle");
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

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
          marketingOptIn: false
        })
      );
    } finally {
      setSignUpSubmitting(false);
    }
  };

  const handleRecoverySubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (!recoveryEmail.trim()) {
      setRecoveryStatus("error");
      setRecoveryMessage("Please enter your email address.");
      return;
    }
    
    setRecoverySubmitting(true);
    setRecoveryStatus("idle");
    setRecoveryMessage(null);
    
    try {
      const result = await requestPasswordReset({ identifier: recoveryEmail.trim() });
      
      if (result.accepted) {
        setRecoveryStatus("success");
        setRecoveryMessage("If that account exists, we'll email recovery instructions.");
        return;
      }
      
      if (result.captchaRequired) {
        setRecoveryStatus("captcha_required");
        setRecoveryMessage("Please complete the captcha challenge to continue.");
        return;
      }
      
      if (result.rateLimited) {
        setRecoveryStatus("rate_limited");
        setRecoveryMessage("You've requested too many resets. Try again shortly.");
        return;
      }
      
      setRecoveryStatus("error");
      setRecoveryMessage("We couldn't process that request. Please try again.");
    } catch (error) {
      setRecoveryStatus("error");
      setRecoveryMessage(error instanceof Error ? error.message : "Failed to submit request.");
    } finally {
      setRecoverySubmitting(false);
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
    <div style={styles.container}>
      <div style={styles.backgroundPattern} />
      <div style={styles.authPanel}>
        <div style={styles.logo}>
          <img 
            src="/images/ThortiqLogo.webp" 
            alt="Thortiq Logo" 
            style={styles.logoImage}
          />
          <h1 style={styles.logoText}>Thortiq</h1>
        </div>
        
        <div style={styles.tabList} role="tablist" aria-label="Authentication modes">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signin"}
            style={{
              ...styles.tabButton,
              ...(mode === "signin" ? styles.tabButtonActive : {})
            }}
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
            style={{
              ...styles.tabButton,
              ...(mode === "signup" ? styles.tabButtonActive : {})
            }}
            onClick={() => setMode("signup")}
          >
            Sign Up
          </button>
        </div>

        {mode === "signin" && (
          <>
            <form onSubmit={handleSignInSubmit} style={styles.form} noValidate>
              <input
                id="login-identifier"
                type="email"
                autoComplete="email"
                placeholder="Email"
                value={signInEmail}
                onChange={(event) => setSignInEmail(event.target.value)}
                disabled={busySigningIn}
                required
                style={{
                  ...styles.input,
                  ...(busySigningIn ? styles.inputDisabled : {})
                }}
                onFocus={(e) => {
                  if (!busySigningIn) {
                    Object.assign(e.target.style, styles.inputFocus);
                  }
                }}
                onBlur={(e) => {
                  e.target.style.outline = "none";
                  e.target.style.borderColor = "#d1d5db";
                  e.target.style.boxShadow = "none";
                }}
              />
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={signInPassword}
                onChange={(event) => setSignInPassword(event.target.value)}
                disabled={busySigningIn}
                required
                style={{
                  ...styles.input,
                  ...(busySigningIn ? styles.inputDisabled : {})
                }}
                onFocus={(e) => {
                  if (!busySigningIn) {
                    Object.assign(e.target.style, styles.inputFocus);
                  }
                }}
                onBlur={(e) => {
                  e.target.style.outline = "none";
                  e.target.style.borderColor = "#d1d5db";
                  e.target.style.boxShadow = "none";
                }}
              />
              <div style={styles.rememberDevice}>
                <div style={styles.rememberDeviceLeft}>
                  <input
                    type="checkbox"
                    checked={signInRemember}
                    onChange={(event) => setSignInRemember(event.target.checked)}
                    disabled={busySigningIn}
                    style={styles.checkbox}
                  />
                  <span>Remember this device</span>
                </div>
                <span
                  style={styles.forgotPasswordLink}
                  onClick={() => setMode("recovery")}
                  onMouseEnter={(e) => {
                    Object.assign(e.currentTarget.style, styles.forgotPasswordLinkHover);
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#667eea";
                  }}
                >
                  Forgot Password?
                </span>
              </div>
              <div style={styles.authActions}>
                <button 
                  type="submit" 
                  disabled={busySigningIn}
                  style={{
                    ...styles.submitButton,
                    ...(busySigningIn ? styles.submitButtonDisabled : {})
                  }}
                  onMouseEnter={(e) => {
                    if (!busySigningIn) {
                      Object.assign(e.currentTarget.style, styles.submitButtonHover);
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!busySigningIn) {
                      e.currentTarget.style.transform = "none";
                      e.currentTarget.style.boxShadow = "0 4px 6px -1px rgba(102, 126, 234, 0.3)";
                    }
                  }}
                >
                  {busySigningIn ? "Signing in…" : "Sign in"}
                </button>
              </div>
              {authError && (
                <div style={styles.errorMessage} role="alert">
                  <AuthErrorNotice error={authError} />
                </div>
              )}
            </form>
            <div style={styles.divider} aria-hidden="true">
              <div style={styles.dividerLine} />
              <span style={styles.dividerText}>or</span>
              <div style={styles.dividerLine} />
            </div>
            <div style={styles.googleButtonContainer}>
              <GoogleSignInButton onClick={() => handleGoogleSignIn(signInRemember)} disabled={busySigningIn} />
            </div>
            {googleError && (
              <div style={styles.errorMessage} role="alert" data-error="google">
                {googleError}
              </div>
            )}
          </>
        )}

        {mode === "signup" && (
          <>
            <h2 style={styles.title}>Create your account</h2>
            <form onSubmit={handleSignUpSubmit} style={styles.form} noValidate>
              <input
                id="signup-identifier"
                type="email"
                autoComplete="email"
                placeholder="Email"
                value={signUpEmail}
                onChange={(event) => setSignUpEmail(event.target.value)}
                disabled={busySigningUp}
                required
                style={{
                  ...styles.input,
                  ...(busySigningUp ? styles.inputDisabled : {})
                }}
                onFocus={(e) => {
                  if (!busySigningUp) {
                    Object.assign(e.target.style, styles.inputFocus);
                  }
                }}
                onBlur={(e) => {
                  e.target.style.outline = "none";
                  e.target.style.borderColor = "#d1d5db";
                  e.target.style.boxShadow = "none";
                }}
              />
              <input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                placeholder="Password"
                value={signUpPassword}
                onChange={(event) => setSignUpPassword(event.target.value)}
                disabled={busySigningUp}
                required
                style={{
                  ...styles.input,
                  ...(busySigningUp ? styles.inputDisabled : {})
                }}
                onFocus={(e) => {
                  if (!busySigningUp) {
                    Object.assign(e.target.style, styles.inputFocus);
                  }
                }}
                onBlur={(e) => {
                  e.target.style.outline = "none";
                  e.target.style.borderColor = "#d1d5db";
                  e.target.style.boxShadow = "none";
                }}
              />
              <label style={styles.rememberDevice}>
                <input
                  type="checkbox"
                  checked={signUpRemember}
                  onChange={(event) => setSignUpRemember(event.target.checked)}
                  disabled={busySigningUp}
                  style={styles.checkbox}
                />
                Remember this device
              </label>
              <fieldset style={styles.consentGroup} disabled={busySigningUp}>
                <legend style={styles.consentLegend}>Consents</legend>
                <label style={styles.consentLabel}>
                  <input 
                    type="checkbox" 
                    checked={acceptTerms && acceptPrivacy} 
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setAcceptTerms(checked);
                      setAcceptPrivacy(checked);
                    }} 
                    required 
                    style={styles.checkbox}
                  />
                  I accept the Terms of Service and Privacy Policy
                </label>
              </fieldset>
              <div style={styles.authActions}>
                <button 
                  type="submit" 
                  disabled={busySigningUp}
                  style={{
                    ...styles.submitButton,
                    ...(busySigningUp ? styles.submitButtonDisabled : {})
                  }}
                  onMouseEnter={(e) => {
                    if (!busySigningUp) {
                      Object.assign(e.currentTarget.style, styles.submitButtonHover);
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!busySigningUp) {
                      e.currentTarget.style.transform = "none";
                      e.currentTarget.style.boxShadow = "0 4px 6px -1px rgba(102, 126, 234, 0.3)";
                    }
                  }}
                >
                  {busySigningUp ? "Creating account…" : "Create account"}
                </button>
              </div>
              {authError && (
                <div style={styles.errorMessage} role="alert">
                  <AuthErrorNotice error={authError} />
                </div>
              )}
            </form>
            <div style={styles.divider} aria-hidden="true">
              <div style={styles.dividerLine} />
              <span style={styles.dividerText}>or</span>
              <div style={styles.dividerLine} />
            </div>
            <div style={styles.googleButtonContainer}>
              <GoogleSignInButton onClick={() => handleGoogleSignIn(signUpRemember)} disabled={busySigningUp} />
            </div>
            {googleError && (
              <div style={styles.errorMessage} role="alert" data-error="google">
                {googleError}
              </div>
            )}
          </>
        )}

        {mode === "recovery" && (
          <div style={styles.recoveryPanel}>
            <h2 style={styles.title}>Reset your password</h2>
            <form onSubmit={handleRecoverySubmit} style={styles.recoveryForm} noValidate>
              <input
                id="recovery-email"
                type="email"
                placeholder="Email"
                value={recoveryEmail}
                onChange={(event) => setRecoveryEmail(event.target.value)}
                disabled={recoverySubmitting}
                required
                style={{
                  ...styles.recoveryInput,
                  ...(recoverySubmitting ? styles.inputDisabled : {})
                }}
                onFocus={(e) => {
                  if (!recoverySubmitting) {
                    Object.assign(e.target.style, styles.inputFocus);
                  }
                }}
                onBlur={(e) => {
                  e.target.style.outline = "none";
                  e.target.style.borderColor = "#d1d5db";
                  e.target.style.boxShadow = "none";
                }}
              />
              <button 
                type="submit" 
                disabled={recoverySubmitting}
                style={{
                  ...styles.recoveryButton,
                  ...(recoverySubmitting ? styles.recoveryButtonDisabled : {})
                }}
                onMouseEnter={(e) => {
                  if (!recoverySubmitting) {
                    Object.assign(e.currentTarget.style, styles.submitButtonHover);
                  }
                }}
                onMouseLeave={(e) => {
                  if (!recoverySubmitting) {
                    e.currentTarget.style.transform = "none";
                    e.currentTarget.style.boxShadow = "0 4px 6px -1px rgba(102, 126, 234, 0.3)";
                  }
                }}
              >
                {recoverySubmitting ? "Sending…" : "Send reset link"}
              </button>
              {recoveryStatus !== "idle" && recoveryMessage && (
                <div 
                  style={{
                    ...styles.recoveryStatus,
                    ...(recoveryStatus === "success" ? styles.recoveryStatusSuccess : {}),
                    ...(recoveryStatus === "error" ? styles.recoveryStatusError : {}),
                    ...(recoveryStatus === "rate_limited" || recoveryStatus === "captcha_required" ? styles.recoveryStatusWarning : {})
                  }}
                  role="status"
                  data-status={recoveryStatus}
                >
                  {recoveryMessage}
                </div>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
