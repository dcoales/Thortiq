import { useState } from "react";

import type { ForgotPasswordResult } from "@thortiq/client-core";

import { useAuthActions, useAuthPendingIdentifier } from "../AuthProvider";
import { AuthErrorNotice } from "./AuthErrorNotice";

export interface AccountRecoveryRequestFormProps {
  readonly initialIdentifier?: string;
  readonly onSubmitted?: (result: ForgotPasswordResult) => void;
  readonly className?: string;
}

interface SubmitState {
  readonly status: "idle" | "submitting" | "success" | "rate_limited" | "captcha_required" | "error";
  readonly message?: string;
}

/**
 * Password reset request form that hits the shared auth store.  The store implements rate limiting
 * and captcha enforcement; the component surfaces those states so platforms can decide how to
 * respond (e.g. show a captcha modal when `captcha_required`).
 */
export const AccountRecoveryRequestForm = ({ initialIdentifier, onSubmitted, className }: AccountRecoveryRequestFormProps) => {
  const { requestPasswordReset } = useAuthActions();
  const suggestedIdentifier = useAuthPendingIdentifier();
  const [identifier, setIdentifier] = useState(initialIdentifier ?? suggestedIdentifier ?? "");
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (identifier.trim().length === 0) {
      setError("Please enter your email address.");
      return;
    }
    setError(null);
    setState({ status: "submitting" });
    try {
      const result = await requestPasswordReset({ identifier: identifier.trim() });
      onSubmitted?.(result);
      if (result.accepted) {
        setState({ status: "success", message: "If that account exists, we’ll email recovery instructions." });
        return;
      }
      if (result.captchaRequired) {
        setState({ status: "captcha_required", message: "Please complete the captcha challenge to continue." });
        return;
      }
      if (result.rateLimited) {
        setState({ status: "rate_limited", message: "You’ve requested too many resets. Try again shortly." });
        return;
      }
      setState({ status: "error", message: "We couldn’t process that request. Please try again." });
    } catch (requestError) {
      setState({ status: "error", message: requestError instanceof Error ? requestError.message : "Failed to submit request." });
    }
  };

  return (
    <form className={className} onSubmit={handleSubmit} noValidate>
      <label htmlFor="account-recovery-identifier">Email</label>
      <input
        id="account-recovery-identifier"
        type="email"
        name="identifier"
        autoComplete="email"
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        disabled={state.status === "submitting"}
        required
      />
      {error ? <div role="alert" data-error="validation">{error}</div> : null}
      <button type="submit" disabled={state.status === "submitting"}>
        {state.status === "submitting" ? "Sending…" : "Send reset link"}
      </button>
      {state.status !== "idle" && state.status !== "submitting" ? (
        <p role="status" data-status={state.status}>
          {state.message}
        </p>
      ) : null}
      <AuthErrorNotice role="status" />
    </form>
  );
};
