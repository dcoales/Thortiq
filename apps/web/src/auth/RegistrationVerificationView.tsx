import { useEffect, useRef } from "react";

import { AuthErrorNotice, useAuthActions, useAuthRememberDevicePreference } from "@thortiq/client-react";

import { getDeviceDescriptor } from "./device";

export interface RegistrationVerificationViewProps {
  readonly token: string;
  readonly onSettled?: () => void;
}

export const RegistrationVerificationView = ({ token, onSettled }: RegistrationVerificationViewProps) => {
  const { verifyRegistration } = useAuthActions();
  const rememberPreference = useAuthRememberDevicePreference();
  const hasTriggeredRef = useRef(false);
  const hasSettledRef = useRef(false);

  useEffect(() => {
    if (hasTriggeredRef.current) {
      return;
    }
    hasTriggeredRef.current = true;
    const descriptor = getDeviceDescriptor();
    (async () => {
      try {
        await verifyRegistration({
          token,
          rememberDevice: rememberPreference,
          deviceId: descriptor.deviceId,
          deviceDisplayName: descriptor.displayName,
          devicePlatform: descriptor.platform
        });
      } finally {
        if (!hasSettledRef.current) {
          hasSettledRef.current = true;
          onSettled?.();
        }
      }
    })().catch(() => {
      // Errors are surfaced through the auth store; nothing to handle here.
    });
    return () => {
      if (!hasSettledRef.current) {
        hasSettledRef.current = true;
        onSettled?.();
      }
    };
  }, [token, rememberPreference, verifyRegistration, onSettled]);

  return (
    <div className="auth-panel">
      <h1>Verifying your account…</h1>
      <p>Hold tight while we confirm your account. This won’t take long.</p>
      <AuthErrorNotice />
    </div>
  );
};
