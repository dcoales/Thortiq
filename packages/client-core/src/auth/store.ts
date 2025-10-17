/**
 * Shared authentication store orchestrating credential lifecycle, refresh scheduling, and
 * persistence.  The store owns the state machine for the client auth UX and intentionally hides
 * sensitive tokens from observers.  Platform adapters access the state through the exported API and
 * persist credentials by injecting a `SecureCredentialStorage` implementation.
 */
import type { AuthHttpClient } from "./httpClient";
import { AuthHttpError } from "./httpClient";
import type { SecureCredentialStorage } from "./storage";
import type { SessionId } from "./types";
import {
  type AuthAuthenticatedState,
  type AuthErrorCode,
  type AuthErrorState,
  type AuthRegisteringState,
  type AuthRegistrationPendingState,
  type AuthState,
  type AuthSessionSecrets,
  type AuthSessionSnapshot,
  type ForgotPasswordResult,
  type GoogleLoginInput,
  type LoginSuccessResult,
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
  type StoredAuthSession
} from "./storeTypes";

import { decodeJwtClaims } from "./jwt";

interface TimerHandle {
  cancel(): void;
}

export interface AuthStoreLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface AuthStoreOptions {
  readonly httpClient: AuthHttpClient;
  readonly credentialStorage: SecureCredentialStorage;
  readonly now?: () => number;
  readonly scheduleTimeout?: (callback: () => void, delayMs: number) => TimerHandle;
  readonly refreshLeewayMs?: number;
  readonly refreshRetryDelaysMs?: ReadonlyArray<number>;
  readonly defaultRememberDevice?: boolean;
  readonly logger?: AuthStoreLogger;
}

export interface AuthStore {
  readonly ready: Promise<void>;
  getState(): AuthState;
  subscribe(listener: () => void): () => void;
  loginWithPassword(input: PasswordLoginInput): Promise<void>;
  loginWithGoogle(input: GoogleLoginInput): Promise<void>;
  registerAccount(input: RegistrationRequestInput): Promise<RegistrationRequestResult>;
  verifyRegistration(input: RegistrationVerificationInput): Promise<void>;
  resendRegistration(input: RegistrationResendInput): Promise<RegistrationResendResult>;
  cancelRegistration(): void;
  submitMfaChallenge(code: string, methodId?: string): Promise<void>;
  cancelMfaChallenge(): void;
  requestPasswordReset(input: PasswordResetRequestInput): Promise<ForgotPasswordResult>;
  submitPasswordReset(input: PasswordResetSubmissionInput): Promise<ResetPasswordResult>;
  refreshTokens(options?: { force?: boolean }): Promise<void>;
  logout(): Promise<void>;
  logoutEverywhere(): Promise<void>;
  loadSessions(): Promise<ReadonlyArray<SessionSummary>>;
  revokeSession(sessionId: SessionId): Promise<void>;
  updateRememberDevice(remember: boolean): Promise<void>;
  getAccessToken(): string | null;
  getSessionSnapshot(): AuthSessionSnapshot | null;
}

interface PendingPasswordLoginContext {
  readonly identifier: string;
  readonly password: string;
  readonly rememberDevice: boolean;
  readonly deviceDisplayName: string;
  readonly devicePlatform: string;
  readonly deviceId?: string;
}

interface PendingGoogleLoginContext {
  readonly idToken: string;
  readonly rememberDevice: boolean;
  readonly deviceDisplayName: string;
  readonly devicePlatform: string;
  readonly deviceId?: string;
}

interface PendingRegistrationContext {
  identifier: string;
  rememberDevice: boolean;
  verificationExpiresAt?: number;
  resendAvailableAt?: number;
  lastSentAt?: number;
}

interface ActiveSession {
  secrets: AuthSessionSecrets;
  snapshot: AuthSessionSnapshot;
}

const DEFAULT_REFRESH_LEEWAY_MS = 60_000;
const DEFAULT_REFRESH_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000];

const cloneTokenPair = (tokens: AuthSessionSecrets["tokens"]): AuthSessionSecrets["tokens"] => ({
  accessToken: tokens.accessToken,
  refreshToken: tokens.refreshToken,
  issuedAt: tokens.issuedAt,
  expiresAt: tokens.expiresAt
});

const createSnapshot = (secrets: AuthSessionSecrets, offline: boolean): AuthSessionSnapshot => ({
  user: { ...secrets.user },
  sessionId: secrets.sessionId,
  deviceId: secrets.deviceId,
  deviceDisplayName: secrets.deviceDisplayName,
  devicePlatform: secrets.devicePlatform,
  trustedDevice: secrets.trustedDevice,
  rememberDevice: secrets.rememberDevice,
  accessTokenExpiresAt: secrets.tokens.expiresAt,
  refreshTokenExpiresAt: secrets.refreshExpiresAt,
  issuedAt: secrets.tokens.issuedAt,
  offline,
  mfaCompleted: secrets.mfaCompleted,
  syncToken: secrets.syncToken
});

const toStoredSession = (secrets: AuthSessionSecrets, now: () => number): StoredAuthSession => ({
  sessionId: secrets.sessionId,
  user: { ...secrets.user },
  tokens: cloneTokenPair(secrets.tokens),
  refreshExpiresAt: secrets.refreshExpiresAt,
  syncToken: secrets.syncToken,
  deviceId: secrets.deviceId,
  deviceDisplayName: secrets.deviceDisplayName,
  devicePlatform: secrets.devicePlatform,
  rememberDevice: secrets.rememberDevice,
  trustedDevice: secrets.trustedDevice,
  mfaCompleted: secrets.mfaCompleted,
  cachedAt: now()
});

const toErrorState = (error: unknown, fallback: AuthErrorCode = "unknown"): AuthErrorState => {
  if (error instanceof AuthHttpError) {
    return {
      code: (error.code as AuthErrorCode) ?? fallback,
      message: error.message,
      retryAfterMs: typeof error.retryAfterMs === "number" ? error.retryAfterMs : undefined,
      cause: error
    } satisfies AuthErrorState;
  }
  if (error instanceof Error) {
    return {
      code: fallback,
      message: error.message,
      cause: error
    } satisfies AuthErrorState;
  }
  return {
    code: fallback
  } satisfies AuthErrorState;
};

const withRememberDevice = (input: AuthState, rememberDevice: boolean): AuthState => {
  switch (input.status) {
    case "unauthenticated":
      return { ...input, rememberDevice };
    case "authenticating":
      return { ...input, rememberDevice };
    case "registering":
      return { ...input, rememberDevice };
    case "registration_pending":
      return { ...input, rememberDevice };
    case "authenticated":
      return { ...input, rememberDevice };
    case "mfa_required":
      return { ...input, rememberDevice };
    case "recovering":
      return { ...input, rememberDevice };
    case "error":
      return { ...input, rememberDevice };
    case "initializing":
    default:
      return { ...input, rememberDevice };
  }
};

const deriveSecrets = (
  result: LoginSuccessResult,
  context: { displayName: string; platform: string; rememberDevice: boolean; deviceId?: string }
): AuthSessionSecrets => {
  const claims = decodeJwtClaims(result.tokens.accessToken);
  return {
    sessionId: result.sessionId ?? (claims?.sessionId as string) ?? "",
    deviceId: result.deviceId ?? context.deviceId ?? (claims?.deviceId as string) ?? "",
    deviceDisplayName: context.displayName,
    devicePlatform: context.platform,
    tokens: cloneTokenPair(result.tokens),
    refreshExpiresAt: result.refreshExpiresAt,
    syncToken: result.syncToken ?? null,
    trustedDevice: result.trustedDevice,
    rememberDevice: context.rememberDevice,
    mfaCompleted: result.mfaCompleted,
    user: { ...result.user }
  } satisfies AuthSessionSecrets;
};

const startTimer = (fn: () => void, delayMs: number): TimerHandle => {
  const id = setTimeout(fn, delayMs);
  return {
    cancel() {
      clearTimeout(id);
    }
  } satisfies TimerHandle;
};

export const createAuthStore = (options: AuthStoreOptions): AuthStore => {
  const http = options.httpClient;
  const storage = options.credentialStorage;
  const now = options.now ?? (() => Date.now());
  const scheduleTimeout = options.scheduleTimeout ?? ((callback: () => void, delayMs: number) => startTimer(callback, delayMs));
  const refreshLeewayMs = options.refreshLeewayMs ?? DEFAULT_REFRESH_LEEWAY_MS;
  const refreshRetryDelays = options.refreshRetryDelaysMs ?? DEFAULT_REFRESH_RETRY_DELAYS_MS;
  const logger = options.logger;

  let state: AuthState = {
    status: "initializing",
    rememberDevice: options.defaultRememberDevice ?? true
  };

  let activeSession: ActiveSession | null = null;
  let refreshTimer: TimerHandle | null = null;
  let refreshRetryAttempt = 0;
  let pendingLoginContext: PendingPasswordLoginContext | null = null;
  let pendingGoogleContext: PendingGoogleLoginContext | null = null;
  let pendingRegistrationContext: PendingRegistrationContext | null = null;
  let rememberDevicePreference = options.defaultRememberDevice ?? true;

  const listeners = new Set<() => void>();
  let readyResolve: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setState = (next: AuthState) => {
    state = next;
    notify();
  };

  const markAuthenticated = (secrets: AuthSessionSecrets, offline: boolean, sessions?: ReadonlyArray<SessionSummary>) => {
    activeSession = {
      secrets,
      snapshot: createSnapshot(secrets, offline)
    } satisfies ActiveSession;
    setState({
      status: "authenticated",
      rememberDevice: secrets.rememberDevice,
      session: activeSession.snapshot,
      sessions
    } satisfies AuthAuthenticatedState);
  };

  const clearRefreshTimer = () => {
    if (refreshTimer) {
      refreshTimer.cancel();
      refreshTimer = null;
    }
  };

  const scheduleRefresh = (expiresAt: number) => {
    clearRefreshTimer();
    const delay = Math.max(expiresAt - refreshLeewayMs - now(), 0);
    logger?.debug("Scheduling token refresh", { delay });
    refreshTimer = scheduleTimeout(async () => {
      await refreshTokens({ force: true });
    }, delay);
  };

  const persistIfNeeded = async (secrets: AuthSessionSecrets) => {
    if (!secrets.rememberDevice) {
      await storage.clear();
      return;
    }
    await storage.save(toStoredSession(secrets, now));
  };

  const resetSession = async () => {
    clearRefreshTimer();
    activeSession = null;
    refreshRetryAttempt = 0;
    pendingLoginContext = null;
    pendingGoogleContext = null;
    pendingRegistrationContext = null;
    await storage.clear();
    setState({
      status: "unauthenticated",
      rememberDevice: rememberDevicePreference
    });
  };

  const handleLoginSuccess = async (
    result: LoginSuccessResult,
    context: { displayName: string; platform: string; rememberDevice: boolean; deviceId?: string }
  ) => {
    const secrets = deriveSecrets(result, context);
    if (!secrets.sessionId || !secrets.deviceId) {
      throw new AuthHttpError("Missing session identifiers", 500, "server_error");
    }
    rememberDevicePreference = context.rememberDevice;
    refreshRetryAttempt = 0;
    pendingRegistrationContext = null;
    await persistIfNeeded(secrets);
    markAuthenticated(secrets, false);
    scheduleRefresh(secrets.tokens.expiresAt);
  };

  const bootstrap = async () => {
    try {
      const cached = await storage.load();
      if (!cached) {
        setState({
          status: "unauthenticated",
          rememberDevice: rememberDevicePreference
        });
        return;
      }
      if (now() >= cached.refreshExpiresAt) {
        await storage.clear();
        setState({
          status: "unauthenticated",
          rememberDevice: rememberDevicePreference
        });
        return;
      }
      const secrets: AuthSessionSecrets = {
        sessionId: cached.sessionId,
        deviceId: cached.deviceId,
        deviceDisplayName: cached.deviceDisplayName,
        devicePlatform: cached.devicePlatform,
        tokens: cloneTokenPair(cached.tokens),
        refreshExpiresAt: cached.refreshExpiresAt,
        syncToken: cached.syncToken,
        trustedDevice: cached.trustedDevice,
        rememberDevice: cached.rememberDevice,
        mfaCompleted: cached.mfaCompleted,
        user: { ...cached.user }
      };
      const offline = cached.tokens.expiresAt <= now();
      markAuthenticated(secrets, offline);
      scheduleRefresh(cached.tokens.expiresAt);
      try {
        await refreshTokens();
      } catch (error) {
      logger?.warn("Initial refresh failed", { error });
      }
    } catch (error) {
      logger?.error("Failed to bootstrap auth store", { error });
      setState({
        status: "error",
        rememberDevice: rememberDevicePreference,
        error: toErrorState(error)
      });
    } finally {
      readyResolve?.();
    }
  };

  const refreshTokens = async (options?: { force?: boolean }): Promise<void> => {
    if (!activeSession) {
      return;
    }
    const secrets = activeSession.secrets;
    const nowTs = now();
    if (!options?.force && secrets.tokens.expiresAt - refreshLeewayMs > nowTs) {
      return;
    }
    try {
      logger?.debug("Refreshing access token", { sessionId: secrets.sessionId });
      const result = await http.refresh({ refreshToken: secrets.tokens.refreshToken });
      const updatedSecrets: AuthSessionSecrets = {
        ...secrets,
        sessionId: result.sessionId ?? secrets.sessionId,
        deviceId: result.deviceId ?? secrets.deviceId,
        tokens: cloneTokenPair(result.tokens),
        refreshExpiresAt: result.refreshExpiresAt,
        syncToken: result.syncToken ?? secrets.syncToken
      };
      refreshRetryAttempt = 0;
      await persistIfNeeded(updatedSecrets);
      markAuthenticated(updatedSecrets, false, state.status === "authenticated" ? state.sessions : undefined);
      scheduleRefresh(updatedSecrets.tokens.expiresAt);
    } catch (error) {
      if (error instanceof AuthHttpError && error.code === "network_error") {
        refreshRetryAttempt = Math.min(refreshRetryAttempt + 1, refreshRetryDelays.length - 1);
        const delay = refreshRetryDelays[refreshRetryAttempt];
        markAuthenticated(
          {
            ...secrets,
            tokens: cloneTokenPair(secrets.tokens)
          },
          true,
          state.status === "authenticated" ? state.sessions : undefined
        );
        clearRefreshTimer();
        refreshTimer = scheduleTimeout(async () => {
          await refreshTokens({ force: true });
        }, delay);
        return;
      }
      logger?.warn("Refresh failed; clearing session", { error });
      await resetSession();
      setState({
        status: "unauthenticated",
        rememberDevice: rememberDevicePreference,
        error: toErrorState(error, "session_revoked")
      });
    }
  };

  void bootstrap();

  const loginInternal = async (input: PasswordLoginInput) => {
    setState({
      status: "authenticating",
      rememberDevice: input.rememberDevice,
      method: "password",
      identifier: input.identifier
    });
    try {
      const result = await http.loginWithPassword(input);
      if ("challenge" in result) {
        pendingLoginContext = {
          identifier: input.identifier,
          password: input.password,
          rememberDevice: input.rememberDevice,
          deviceDisplayName: input.deviceDisplayName,
          devicePlatform: input.devicePlatform,
          deviceId: input.deviceId
        } satisfies PendingPasswordLoginContext;
        setState({
          status: "mfa_required",
          rememberDevice: input.rememberDevice,
          challenge: result.challenge
        });
        return;
      }
      pendingLoginContext = null;
      await handleLoginSuccess(result as LoginSuccessResult, {
        displayName: input.deviceDisplayName,
        platform: input.devicePlatform,
        rememberDevice: input.rememberDevice,
        deviceId: input.deviceId
      });
    } catch (error) {
      pendingLoginContext = null;
      setState({
        status: "unauthenticated",
        rememberDevice: input.rememberDevice,
        lastIdentifier: input.identifier,
        error: toErrorState(error, error instanceof AuthHttpError ? (error.code as AuthErrorCode) : "unknown")
      });
    }
  };

  const loginWithGoogleInternal = async (input: GoogleLoginInput) => {
    setState({
      status: "authenticating",
      rememberDevice: input.rememberDevice,
      method: "google"
    });
    try {
      const result = await http.loginWithGoogle(input);
      if ("challenge" in result) {
        pendingGoogleContext = {
          idToken: input.idToken,
          rememberDevice: input.rememberDevice,
          deviceDisplayName: input.deviceDisplayName,
          devicePlatform: input.devicePlatform,
          deviceId: input.deviceId
        } satisfies PendingGoogleLoginContext;
        setState({
          status: "mfa_required",
          rememberDevice: input.rememberDevice,
          challenge: result.challenge
        });
        return;
      }
      pendingGoogleContext = null;
      pendingLoginContext = null;
      await handleLoginSuccess(result as LoginSuccessResult, {
        displayName: input.deviceDisplayName,
        platform: input.devicePlatform,
        rememberDevice: input.rememberDevice,
        deviceId: input.deviceId
      });
    } catch (error) {
      pendingGoogleContext = null;
      setState({
        status: "unauthenticated",
        rememberDevice: input.rememberDevice,
        error: toErrorState(error, error instanceof AuthHttpError ? (error.code as AuthErrorCode) : "unknown")
      });
    }
  };

  const registerInternal = async (input: RegistrationRequestInput): Promise<RegistrationRequestResult> => {
    rememberDevicePreference = input.rememberDevice;
    setState({
      status: "registering",
      rememberDevice: input.rememberDevice,
      identifier: input.identifier,
      consentsAccepted: input.consents.termsAccepted && input.consents.privacyAccepted,
      verificationPending: true
    } satisfies AuthRegisteringState);
    try {
      const result = await http.registerAccount(input);
      pendingRegistrationContext = {
        identifier: input.identifier,
        rememberDevice: input.rememberDevice,
        verificationExpiresAt: result.verificationExpiresAt,
        resendAvailableAt: result.resendAvailableAt,
        lastSentAt: now()
      };
      setState({
        status: "registration_pending",
        rememberDevice: input.rememberDevice,
        identifier: input.identifier,
        verificationExpiresAt: result.verificationExpiresAt,
        resendAvailableAt: result.resendAvailableAt,
        rateLimited: result.rateLimited,
        captchaRequired: result.captchaRequired
      } satisfies AuthRegistrationPendingState);
      return result;
    } catch (error) {
      const errorState = toErrorState(error, error instanceof AuthHttpError ? (error.code as AuthErrorCode) : "unknown");
      if (pendingRegistrationContext) {
        setState({
          status: "registration_pending",
          rememberDevice: pendingRegistrationContext.rememberDevice,
          identifier: pendingRegistrationContext.identifier,
          verificationExpiresAt: pendingRegistrationContext.verificationExpiresAt,
          resendAvailableAt: pendingRegistrationContext.resendAvailableAt,
          error: errorState
        } satisfies AuthRegistrationPendingState);
      } else {
        setState({
          status: "registering",
          rememberDevice: input.rememberDevice,
          identifier: input.identifier,
          consentsAccepted: input.consents.termsAccepted && input.consents.privacyAccepted,
          error: errorState
        } satisfies AuthRegisteringState);
      }
      throw error;
    }
  };

  const resendRegistrationInternal = async (input: RegistrationResendInput): Promise<RegistrationResendResult> => {
    const identifier = input.identifier;
    const existing = pendingRegistrationContext ?? {
      identifier,
      rememberDevice: rememberDevicePreference
    };
    try {
      const result = await http.resendRegistration(input);
      pendingRegistrationContext = {
        identifier,
        rememberDevice: existing.rememberDevice,
        verificationExpiresAt: result.verificationExpiresAt ?? existing.verificationExpiresAt,
        resendAvailableAt: result.resendAvailableAt,
        lastSentAt: now()
      };
      setState({
        status: "registration_pending",
        rememberDevice: pendingRegistrationContext.rememberDevice,
        identifier: pendingRegistrationContext.identifier,
        verificationExpiresAt: pendingRegistrationContext.verificationExpiresAt,
        resendAvailableAt: pendingRegistrationContext.resendAvailableAt,
        rateLimited: result.rateLimited,
        captchaRequired: result.captchaRequired,
        resentAt: pendingRegistrationContext.lastSentAt
      } satisfies AuthRegistrationPendingState);
      return result;
    } catch (error) {
      const errorState = toErrorState(error, error instanceof AuthHttpError ? (error.code as AuthErrorCode) : "unknown");
      setState({
        status: "registration_pending",
        rememberDevice: existing.rememberDevice,
        identifier: existing.identifier,
        verificationExpiresAt: existing.verificationExpiresAt,
        resendAvailableAt: existing.resendAvailableAt,
        error: errorState
      } satisfies AuthRegistrationPendingState);
      throw error;
    }
  };

  const verifyRegistrationInternal = async (input: RegistrationVerificationInput): Promise<void> => {
    rememberDevicePreference = input.rememberDevice;
    setState({
      status: "authenticating",
      rememberDevice: input.rememberDevice,
      method: "register",
      identifier: pendingRegistrationContext?.identifier
    });
    try {
      const result = await http.verifyRegistration(input);
      pendingRegistrationContext = null;
      await handleLoginSuccess(result, {
        displayName: input.deviceDisplayName,
        platform: input.devicePlatform,
        rememberDevice: input.rememberDevice,
        deviceId: input.deviceId
      });
    } catch (error) {
      const errorState = toErrorState(error, error instanceof AuthHttpError ? (error.code as AuthErrorCode) : "unknown");
      if (error instanceof AuthHttpError && error.code === "invalid_token") {
        pendingRegistrationContext = null;
        setState({
          status: "unauthenticated",
          rememberDevice: rememberDevicePreference,
          error: errorState
        });
      } else if (pendingRegistrationContext) {
        setState({
          status: "registration_pending",
          rememberDevice: pendingRegistrationContext.rememberDevice,
          identifier: pendingRegistrationContext.identifier,
          verificationExpiresAt: pendingRegistrationContext.verificationExpiresAt,
          resendAvailableAt: pendingRegistrationContext.resendAvailableAt,
          error: errorState
        } satisfies AuthRegistrationPendingState);
      } else {
        setState({
          status: "unauthenticated",
          rememberDevice: rememberDevicePreference,
          error: errorState
        });
      }
      throw error;
    }
  };

  const cancelRegistrationInternal = () => {
    pendingRegistrationContext = null;
    setState({
      status: "unauthenticated",
      rememberDevice: rememberDevicePreference
    });
  };

  const completeMfa = async (code: string, methodId?: string) => {
    if (pendingLoginContext) {
      await loginInternal({
        ...pendingLoginContext,
        mfaCode: code,
        mfaMethodId: methodId
      });
      return;
    }
    if (pendingGoogleContext) {
      await loginWithGoogleInternal({
        idToken: pendingGoogleContext.idToken,
        rememberDevice: pendingGoogleContext.rememberDevice,
        deviceDisplayName: pendingGoogleContext.deviceDisplayName,
        devicePlatform: pendingGoogleContext.devicePlatform,
        deviceId: pendingGoogleContext.deviceId,
        mfaCode: code,
        mfaMethodId: methodId
      });
      return;
    }
    setState({
      status: "unauthenticated",
      rememberDevice: rememberDevicePreference
    });
  };

  const logoutInternal = async (revokeAll: boolean) => {
    if (!activeSession) {
      await resetSession();
      setState({
        status: "unauthenticated",
        rememberDevice: rememberDevicePreference
      });
      return;
    }
    const accessToken = activeSession.secrets.tokens.accessToken;
    try {
      if (revokeAll) {
        await http.logoutAll(accessToken);
      } else {
        await http.logout(accessToken);
      }
    } catch (error) {
      logger?.warn("Logout request failed", { error, revokeAll });
    } finally {
      await resetSession();
    }
  };

  const loadSessionsInternal = async (): Promise<ReadonlyArray<SessionSummary>> => {
    if (!activeSession) {
      return [];
    }
    try {
      const { sessions } = await http.listSessions(activeSession.secrets.tokens.accessToken);
      if (state.status === "authenticated") {
        setState({
          status: "authenticated",
          rememberDevice: state.rememberDevice,
          session: activeSession.snapshot,
          sessions
        });
      }
      return sessions;
    } catch (error) {
      logger?.warn("Failed to load session list", { error });
      if (state.status === "authenticated") {
        setState({
          status: "authenticated",
          rememberDevice: state.rememberDevice,
          session: activeSession.snapshot,
          sessions: state.sessions ?? []
        });
      }
      return state.status === "authenticated" && state.sessions ? state.sessions : [];
    }
  };

  return {
    ready,
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async loginWithPassword(input: PasswordLoginInput): Promise<void> {
      pendingRegistrationContext = null;
      await loginInternal(input);
    },
    async loginWithGoogle(input: GoogleLoginInput): Promise<void> {
      pendingLoginContext = null;
      pendingGoogleContext = null;
      pendingRegistrationContext = null;
      await loginWithGoogleInternal(input);
    },
    async registerAccount(input: RegistrationRequestInput): Promise<RegistrationRequestResult> {
      return registerInternal(input);
    },
    async verifyRegistration(input: RegistrationVerificationInput): Promise<void> {
      await verifyRegistrationInternal(input);
    },
    async resendRegistration(input: RegistrationResendInput): Promise<RegistrationResendResult> {
      return resendRegistrationInternal(input);
    },
    cancelRegistration(): void {
      cancelRegistrationInternal();
    },
    async submitMfaChallenge(code: string, methodId?: string): Promise<void> {
      await completeMfa(code, methodId);
    },
    cancelMfaChallenge(): void {
      pendingLoginContext = null;
      pendingGoogleContext = null;
      setState({
        status: "unauthenticated",
        rememberDevice: rememberDevicePreference
      });
    },
    async requestPasswordReset(input: PasswordResetRequestInput): Promise<ForgotPasswordResult> {
      return http.requestPasswordReset(input);
    },
    async submitPasswordReset(input: PasswordResetSubmissionInput): Promise<ResetPasswordResult> {
      return http.submitPasswordReset(input);
    },
    async refreshTokens(options?: { force?: boolean }): Promise<void> {
      await refreshTokens(options);
    },
    async logout(): Promise<void> {
      await logoutInternal(false);
    },
    async logoutEverywhere(): Promise<void> {
      await logoutInternal(true);
    },
    async loadSessions(): Promise<ReadonlyArray<SessionSummary>> {
      return loadSessionsInternal();
    },
    async revokeSession(sessionId: SessionId): Promise<void> {
      if (!activeSession) {
        return;
      }
      try {
        await http.revokeSession(activeSession.secrets.tokens.accessToken, sessionId);
        await loadSessionsInternal();
      } catch (error) {
        logger?.warn("Failed to revoke session", { error });
      }
    },
    async updateRememberDevice(remember: boolean): Promise<void> {
      rememberDevicePreference = remember;
      if (activeSession) {
        const updatedSecrets: AuthSessionSecrets = {
          ...activeSession.secrets,
          rememberDevice: remember
        };
        if (!remember) {
          await storage.clear();
        } else {
          await storage.save(toStoredSession(updatedSecrets, now));
        }
        markAuthenticated(updatedSecrets, activeSession.snapshot.offline, state.status === "authenticated" ? state.sessions : undefined);
      } else {
        setState(withRememberDevice(state, remember));
      }
    },
    getAccessToken(): string | null {
      return activeSession?.secrets.tokens.accessToken ?? null;
    },
    getSessionSnapshot(): AuthSessionSnapshot | null {
      return activeSession?.snapshot ?? null;
    }
  } satisfies AuthStore;
};
