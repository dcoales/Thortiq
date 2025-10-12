import type { PropsWithChildren, ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  createAuthStore,
  type AuthState,
  type AuthStore,
  type AuthStoreOptions,
  type AuthSessionSnapshot,
  type AuthErrorState,
  type AuthRegistrationPendingState,
  type ForgotPasswordResult,
  type GoogleLoginInput,
  type MfaChallengeState,
  type PasswordLoginInput,
  type PasswordResetRequestInput,
  type PasswordResetSubmissionInput,
  type RegistrationRequestInput,
  type RegistrationRequestResult,
  type RegistrationResendInput,
  type RegistrationResendResult,
  type RegistrationVerificationInput,
  type ResetPasswordResult,
  type SessionSummary,
  type SessionId
} from "@thortiq/client-core";

/**
 * React bindings for the shared authentication store.  This provider mirrors the approach used by
 * the outline provider so that applications can subscribe to state updates via
 * `useSyncExternalStore` without leaking implementation details from the core store.
 */

export interface AuthProviderProps extends PropsWithChildren {
  readonly options?: AuthStoreOptions;
  readonly store?: AuthStore;
  readonly createStore?: (options: AuthStoreOptions) => AuthStore;
  readonly loadingFallback?: ReactNode;
}

const AuthStoreContext = createContext<AuthStore | null>(null);

const ensureStore = (
  store: AuthStore | undefined,
  options: AuthStoreOptions | undefined,
  createStore: ((options: AuthStoreOptions) => AuthStore) | undefined
): AuthStore => {
  if (store) {
    return store;
  }
  if (!options) {
    throw new Error("AuthProvider requires options when no store instance is supplied");
  }
  const factory = createStore ?? createAuthStore;
  return factory(options);
};

export const AuthProvider = ({ store: providedStore, options, createStore, loadingFallback = null, children }: AuthProviderProps) => {
  const store = useMemo(() => ensureStore(providedStore, options, createStore), [providedStore, options, createStore]);
  const [isReady, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    store.ready
      .then(() => {
        if (active) {
          setReady(true);
        }
      })
      .catch((error) => {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("[AuthProvider] failed to initialise", error);
        }
        if (active) {
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [store]);

  if (!isReady) {
    return <>{loadingFallback}</>;
  }

  return <AuthStoreContext.Provider value={store}>{children}</AuthStoreContext.Provider>;
};

export const useAuthStore = (): AuthStore => {
  const store = useContext(AuthStoreContext);
  if (!store) {
    throw new Error("useAuthStore must be used within AuthProvider");
  }
  return store;
};

export const useAuthState = (): AuthState => {
  const store = useAuthStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
};

export const useAuthSession = (): AuthSessionSnapshot | null => {
  const state = useAuthState();
  return state.status === "authenticated" ? state.session : null;
};

export const useAuthSessions = (): readonly SessionSummary[] => {
  const state = useAuthState();
  if (state.status === "authenticated" && state.sessions) {
    return state.sessions;
  }
  return [];
};

export interface AuthActions {
  loginWithPassword(input: PasswordLoginInput): Promise<void>;
  loginWithGoogle(input: GoogleLoginInput): Promise<void>;
  registerAccount(input: RegistrationRequestInput): Promise<RegistrationRequestResult>;
  verifyRegistration(input: RegistrationVerificationInput): Promise<void>;
  resendRegistration(input: RegistrationResendInput): Promise<RegistrationResendResult>;
  cancelRegistration(): void;
  submitMfa(code: string, methodId?: string): Promise<void>;
  cancelMfa(): void;
  requestPasswordReset(input: PasswordResetRequestInput): Promise<ForgotPasswordResult>;
  submitPasswordReset(input: PasswordResetSubmissionInput): Promise<ResetPasswordResult>;
  refreshTokens(options?: { force?: boolean }): Promise<void>;
  logout(): Promise<void>;
  logoutEverywhere(): Promise<void>;
  loadSessions(): Promise<ReadonlyArray<SessionSummary>>;
  revokeSession(sessionId: SessionId): Promise<void>;
  updateRememberDevice(remember: boolean): Promise<void>;
}

export const useAuthActions = (): AuthActions => {
  const store = useAuthStore();
  return useMemo<AuthActions>(
    () => ({
      loginWithPassword: async (input: PasswordLoginInput) => {
        await store.loginWithPassword(input);
      },
      loginWithGoogle: async (input: GoogleLoginInput) => {
        await store.loginWithGoogle(input);
      },
      registerAccount: async (input: RegistrationRequestInput) => {
        return store.registerAccount(input);
      },
      verifyRegistration: async (input: RegistrationVerificationInput) => {
        await store.verifyRegistration(input);
      },
      resendRegistration: async (input: RegistrationResendInput) => {
        return store.resendRegistration(input);
      },
      cancelRegistration: () => {
        store.cancelRegistration();
      },
      submitMfa: async (code: string, methodId?: string) => {
        await store.submitMfaChallenge(code, methodId);
      },
      cancelMfa: () => {
        store.cancelMfaChallenge();
      },
      requestPasswordReset: async (input: PasswordResetRequestInput) => {
        return store.requestPasswordReset(input);
      },
      submitPasswordReset: async (input: PasswordResetSubmissionInput) => {
        return store.submitPasswordReset(input);
      },
      refreshTokens: async (options?: { force?: boolean }) => {
        await store.refreshTokens(options);
      },
      logout: async () => {
        await store.logout();
      },
      logoutEverywhere: async () => {
        await store.logoutEverywhere();
      },
      loadSessions: async () => {
        return store.loadSessions();
      },
      revokeSession: async (sessionId: SessionId) => {
        await store.revokeSession(sessionId);
      },
      updateRememberDevice: async (remember: boolean) => {
        await store.updateRememberDevice(remember);
      }
    }),
    [store]
  );
};

export const useAuthIsAuthenticated = (): boolean => {
  const state = useAuthState();
  return state.status === "authenticated";
};

export const useAuthIsAuthenticating = (): boolean => {
  const state = useAuthState();
  return state.status === "authenticating" || state.status === "registering";
};

export const useAuthError = (): AuthErrorState | undefined => {
  const state = useAuthState();
  if (state.status === "unauthenticated") {
    return state.error;
  }
  if (state.status === "registering") {
    return state.error;
  }
  if (state.status === "registration_pending") {
    return state.error;
  }
  if (state.status === "error") {
    return state.error;
  }
  return undefined;
};

export const useAuthPendingIdentifier = (): string | undefined => {
  const state = useAuthState();
  if (state.status === "unauthenticated") {
    return state.lastIdentifier;
  }
  if (state.status === "mfa_required") {
    return state.challenge.identifier;
  }
  if (state.status === "registration_pending") {
    return state.identifier;
  }
  return undefined;
};

export const useAuthRememberDevicePreference = (): boolean => {
  const state = useAuthState();
  return state.rememberDevice;
};

export const useAuthRegistrationPending = (): AuthRegistrationPendingState | null => {
  const state = useAuthState();
  return state.status === "registration_pending" ? state : null;
};

export const useAuthIsRegistering = (): boolean => {
  const state = useAuthState();
  return state.status === "registering";
};
export const useAuthMfaChallenge = (): MfaChallengeState | null => {
  const state = useAuthState();
  if (state.status === "mfa_required") {
    return state.challenge;
  }
  return null;
};

export const useAuthRecoveryState = (): { stage: "request" | "reset"; identifier?: string; pendingToken?: string } | null => {
  const state = useAuthState();
  if (state.status === "recovering") {
    return {
      stage: state.stage,
      identifier: state.identifier,
      pendingToken: state.pendingToken
    };
  }
  return null;
};
