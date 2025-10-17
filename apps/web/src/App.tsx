import { useMemo, useState } from "react";

import { AuthErrorNotice, PasswordResetForm, useAuthState } from "@thortiq/client-react";

import { AuthenticatedApp } from "./auth/AuthenticatedApp";
import { LoginView } from "./auth/LoginView";
import { MfaChallengeView } from "./auth/MfaChallengeView";
import { RegistrationVerificationView } from "./auth/RegistrationVerificationView";

const useResetToken = (): string | null => {
  return useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }
    const params = new URLSearchParams(window.location.search);
    return params.get("resetToken");
  }, []);
};

const useRegistrationToken = (): string | null => {
  return useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }
    const params = new URLSearchParams(window.location.search);
    return params.get("registerToken") ?? params.get("token");
  }, []);
};

export const App = () => {
  const authState = useAuthState();
  const initialResetToken = useResetToken();
  const initialRegistrationToken = useRegistrationToken();
  const [resetToken, setResetToken] = useState<string | null>(initialResetToken);
  const [registrationToken, setRegistrationToken] = useState<string | null>(initialRegistrationToken);

  const clearResetToken = () => {
    setResetToken(null);
    if (typeof window !== "undefined") {
      const { pathname, hash } = window.location;
      window.history.replaceState(null, document.title, hash ? `${pathname}${hash}` : pathname);
    }
  };

  const clearRegistrationToken = () => {
    setRegistrationToken(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("registerToken");
      url.searchParams.delete("token");
      const query = url.searchParams.toString();
      const nextPath = query ? `${url.pathname}?${query}` : url.pathname;
      const next = url.hash ? `${nextPath}${url.hash}` : nextPath;
      window.history.replaceState(null, document.title, next);
    }
  };

  if (authState.status === "initializing") {
    return <div className="app-loading" data-testid="auth-initializing">Preparing workspace…</div>;
  }

  if (authState.status === "authenticating" || authState.status === "registering") {
    return <div className="app-loading" data-testid="auth-authenticating">Signing you in…</div>;
  }

  if (authState.status === "mfa_required") {
    return <MfaChallengeView />;
  }

  if (authState.status === "authenticated") {
    return <AuthenticatedApp />;
  }

  if (authState.status === "error") {
    return (
      <div className="auth-error-screen">
        <h1>Authentication error</h1>
        <AuthErrorNotice error={authState.error} />
      </div>
    );
  }

  if (resetToken) {
    return (
      <div className="auth-panel">
        <h1>Reset password</h1>
        <PasswordResetForm
          token={resetToken}
          onReset={(result) => {
            if (result.success) {
              clearResetToken();
            }
          }}
        />
      </div>
    );
  }

  if (registrationToken) {
    return <RegistrationVerificationView token={registrationToken} onSettled={clearRegistrationToken} />;
  }

  return <LoginView />;
};
