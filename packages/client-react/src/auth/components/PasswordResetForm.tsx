import { useMemo, useState } from "react";

import type { ResetPasswordResult } from "@thortiq/client-core";

import { useAuthActions } from "../AuthProvider";
import { AuthErrorNotice } from "./AuthErrorNotice";

export interface PasswordResetFormProps {
  readonly token: string;
  readonly onReset?: (result: ResetPasswordResult) => void;
  readonly className?: string;
  readonly minPasswordLength?: number;
}

type ResetStatus = "idle" | "submitting" | "success" | "invalid_token" | "error";

const DEFAULT_MIN_LENGTH = 12;

/**
 * Reset form that captures a new password and submits it through the auth store.  Validation is
 * intentionally lightweight: minimum length and confirmation match.  Callers can supply an
 * `onReset` handler to redirect or show follow-up messaging.
 */
export const PasswordResetForm = ({ token, onReset, className, minPasswordLength }: PasswordResetFormProps) => {
  const { submitPasswordReset } = useAuthActions();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<ResetStatus>("idle");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");

  const minLength = useMemo(() => minPasswordLength ?? DEFAULT_MIN_LENGTH, [minPasswordLength]);

  const validate = (): boolean => {
    if (password.length < minLength) {
      setValidationError(`Use at least ${minLength} characters.`);
      return false;
    }
    if (password !== confirmPassword) {
      setValidationError("Passwords do not match.");
      return false;
    }
    setValidationError(null);
    return true;
  };

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (!validate()) {
      return;
    }
    setStatus("submitting");
    setMessage("");
    try {
      const result = await submitPasswordReset({ token, password });
      onReset?.(result);
      if (!result.success && result.errorCode === "invalid_token") {
        setStatus("invalid_token");
        setMessage("This reset link is no longer valid. Request another.");
        return;
      }
      if (!result.success) {
        setStatus("error");
        setMessage("We couldn’t update your password. Try again later.");
        return;
      }
      setStatus("success");
      setMessage("Password updated. You can now sign in with the new password.");
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Reset failed. Please try again.");
    }
  };

  return (
    <form className={className} onSubmit={handleSubmit} noValidate>
      <label htmlFor="password-reset-new">New password</label>
      <input
        id="password-reset-new"
        type="password"
        name="new-password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={status === "submitting" || status === "success"}
        required
        minLength={minLength}
      />
      <label htmlFor="password-reset-confirm">Confirm password</label>
      <input
        id="password-reset-confirm"
        type="password"
        name="confirm-password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        disabled={status === "submitting" || status === "success"}
        required
        minLength={minLength}
      />
      {validationError ? <div role="alert" data-error="validation">{validationError}</div> : null}
      <button type="submit" disabled={status === "submitting"}>
        {status === "submitting" ? "Updating…" : "Update password"}
      </button>
      {message ? (
        <p role="status" data-status={status}>
          {message}
        </p>
      ) : null}
      <AuthErrorNotice role="status" />
    </form>
  );
};
