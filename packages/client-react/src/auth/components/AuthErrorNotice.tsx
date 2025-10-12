/**
 * Simple helper that surfaces authentication errors with sensible default messaging.  Consumers can
 * either rely on the built-in copy or provide a render override for custom layouts.
 */
import type { ReactNode } from "react";
import { useMemo } from "react";

import type { AuthErrorCode, AuthErrorState } from "@thortiq/client-core";

import { useAuthError } from "../AuthProvider";

const DEFAULT_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  network_error: "We couldn’t reach the server. Check your connection and try again.",
  invalid_credentials: "The email or password you entered is incorrect.",
  server_error: "Something went wrong on our side. Please try again.",
  rate_limited: "Too many attempts. Please wait a moment and try again.",
  captcha_required: "Please complete the security check to continue.",
  session_revoked: "Your session expired. Please sign in again.",
  invalid_token: "This link is no longer valid. Request a new one.",
  token_expired: "This link has expired. Please request a new one.",
  invalid_password: "Password must meet the minimum strength requirements.",
  invalid_email: "Enter a valid email address.",
  consent_required: "Please accept the required policies to continue.",
  unknown: "An unexpected error occurred."
};

export interface AuthErrorNoticeProps {
  readonly error?: AuthErrorState | null;
  readonly className?: string;
  readonly role?: "alert" | "status";
  readonly render?: (message: string, error: AuthErrorState) => ReactNode;
}

const resolveMessage = (error: AuthErrorState): string => {
  if (error.message && error.message.length > 0) {
    return error.message;
  }
  return DEFAULT_ERROR_MESSAGES[error.code] ?? DEFAULT_ERROR_MESSAGES.unknown;
};

export const AuthErrorNotice = ({ error: providedError, className, role = "alert", render }: AuthErrorNoticeProps) => {
  const contextError = useAuthError();
  const error = useMemo(() => providedError ?? contextError ?? null, [providedError, contextError]);

  if (!error) {
    return null;
  }

  const message = resolveMessage(error);

  if (render) {
    return <>{render(message, error)}</>;
  }

  return (
    <div role={role} className={className} data-error-code={error.code} aria-live={role === "alert" ? "assertive" : "polite"}>
      {message}
    </div>
  );
};
