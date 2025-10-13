/**
 * Minimal HTTP client for the authentication service.  The client normalises responses from the
 * REST endpoints so the auth store can remain transport agnostic.  Errors are surfaced with
 * strongly typed error codes so calling code can implement nuanced UX (captcha prompts, retry
 * timers, etc.).
 */
import type { MfaMethodType, TokenClaims } from "./types";
import type {
  ForgotPasswordResult,
  GoogleLoginInput,
  LoginMfaRequiredResult,
  LoginResult,
  LoginSuccessResult,
  PasswordLoginInput,
  PasswordResetRequestInput,
  PasswordResetSubmissionInput,
  RefreshResult,
  RegistrationRequestInput,
  RegistrationRequestResult,
  RegistrationResendInput,
  RegistrationResendResult,
  RegistrationVerificationInput,
  ResetPasswordResult,
  SessionsListResult
} from "./storeTypes";

import { decodeJwtClaims } from "./jwt";

export interface AuthHttpClientOptions {
  readonly baseUrl?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly includeCredentials?: boolean;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
}

export class AuthHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterMs?: number;
  readonly payload?: unknown;

  constructor(
    message: string,
    status: number,
    code: string,
    options: { retryAfterMs?: number; payload?: unknown; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "AuthHttpError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
    this.payload = options.payload;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface AuthHttpClient {
  loginWithPassword(input: PasswordLoginInput): Promise<LoginResult>;
  loginWithGoogle(input: GoogleLoginInput): Promise<LoginResult>;
  registerAccount(input: RegistrationRequestInput): Promise<RegistrationRequestResult>;
  verifyRegistration(input: RegistrationVerificationInput): Promise<LoginSuccessResult>;
  resendRegistration(input: RegistrationResendInput): Promise<RegistrationResendResult>;
  refresh(input?: { refreshToken?: string }): Promise<RefreshResult>;
  logout(accessToken: string): Promise<void>;
  logoutAll(accessToken: string): Promise<void>;
  requestPasswordReset(input: PasswordResetRequestInput): Promise<ForgotPasswordResult>;
  submitPasswordReset(input: PasswordResetSubmissionInput): Promise<ResetPasswordResult>;
  listSessions(accessToken: string): Promise<SessionsListResult>;
  revokeSession(accessToken: string, sessionId: string): Promise<void>;
}

interface JsonFetchOptions {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly includeCredentials: boolean;
}

interface LoginSuccessPayload {
  readonly status?: "success";
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly refreshExpiresAt: number;
  readonly syncToken?: string | null;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
    readonly createdAt?: number;
    readonly updatedAt?: number;
    readonly emailVerified?: boolean;
    readonly locale?: string | null;
  };
  readonly sessionId?: string;
  readonly deviceId?: string;
  readonly trustedDevice?: boolean;
  readonly device?: {
    readonly id: string;
    readonly displayName: string;
    readonly platform: string;
    readonly trusted: boolean;
  };
  readonly mfaCompleted?: boolean;
}

interface LoginMfaPayload {
  readonly status: "mfa_required";
  readonly methods: ReadonlyArray<{
    readonly id: string;
    readonly type: string;
    readonly label?: string | null;
  }>;
  readonly userId?: string;
  readonly deviceId?: string;
}

interface RegistrationPendingPayload {
  readonly status: "pending";
  readonly verificationExpiresAt?: number;
  readonly resendAvailableAt?: number;
  readonly rateLimited?: boolean;
  readonly captchaRequired?: boolean;
}

const DEFAULT_BASE_URL = "";

const mapErrorCode = (input: unknown): string => {
  if (typeof input !== "string") {
    return "unknown";
  }
  switch (input) {
    case "invalid_credentials":
      return "invalid_credentials";
    case "rate_limited":
      return "rate_limited";
    case "captcha_required":
      return "captcha_required";
    case "invalid_token":
      return "invalid_token";
    case "token_expired":
      return "token_expired";
    case "session_revoked":
      return "session_revoked";
    case "invalid_password":
      return "invalid_password";
    case "invalid_email":
      return "invalid_email";
    case "consent_required":
      return "consent_required";
    default:
      return "unknown";
  }
};

const toRetryAfter = (response: Response): number | undefined => {
  const retry = response.headers.get("Retry-After");
  if (!retry) {
    return undefined;
  }
  const value = Number.parseInt(retry, 10);
  if (Number.isNaN(value)) {
    return undefined;
  }
  return value * 1000;
};

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new AuthHttpError("Invalid JSON payload", response.status, "server_error", {
      payload: text,
      cause: error
    });
  }
};

const wasNetworkError = (error: unknown): error is TypeError => error instanceof TypeError;

const applyDefaultHeaders = (
  headers: Readonly<Record<string, string>> | undefined,
  defaults: Readonly<Record<string, string>> | undefined
): Record<string, string> => {
  return {
    ...(defaults ?? {}),
    ...(headers ?? {})
  };
};

const normaliseClaims = (claims: Partial<TokenClaims> | null): { sessionId?: string; deviceId?: string } => {
  if (!claims) {
    return {};
  }
  const result: { sessionId?: string; deviceId?: string } = {};
  if (typeof claims.sessionId === "string") {
    result.sessionId = claims.sessionId;
  }
  if (typeof claims.deviceId === "string") {
    result.deviceId = claims.deviceId;
  }
  return result;
};

const ensureFetch = (impl: typeof fetch | undefined): typeof fetch => {
  if (impl) {
    return impl;
  }
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }
  throw new Error("fetch is not available; provide fetchImplementation to createAuthHttpClient");
};

const createJsonFetcher = (
  options: AuthHttpClientOptions
): ((input: JsonFetchOptions) => Promise<Response>) => {
  const fetchImpl = ensureFetch(options.fetchImplementation);
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  return async ({ method, path, body, headers, includeCredentials: localIncludeCredentials }: JsonFetchOptions) => {
    const url = `${baseUrl}${path}`;
    const include = localIncludeCredentials ?? options.includeCredentials ?? true;
    const response = await fetchImpl(url, {
      method,
      headers: applyDefaultHeaders(
        {
          "Content-Type": "application/json",
          ...(headers ?? {})
        },
        options.defaultHeaders
      ),
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: include ? "include" : "same-origin"
    });
    return response;
  };
};

const toLoginSuccessResult = (
  payload: LoginSuccessPayload,
  fallbackTrusted: boolean
): LoginSuccessResult => {
  const claims = normaliseClaims(decodeJwtClaims(payload.accessToken));
  const result: LoginSuccessResult = {
    user: {
      id: payload.user.id,
      email: payload.user.email,
      emailVerified: payload.user.emailVerified ?? true,
      displayName: payload.user.displayName,
      createdAt: payload.user.createdAt ?? payload.issuedAt,
      updatedAt: payload.user.updatedAt ?? payload.issuedAt,
      deletedAt: null,
      locale: payload.user.locale ?? null
    },
    tokens: {
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken ?? "",
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt
    },
    refreshExpiresAt: payload.refreshExpiresAt,
    syncToken: payload.syncToken ?? null,
    sessionId: payload.sessionId ?? claims.sessionId,
    deviceId: payload.device?.id ?? payload.deviceId ?? claims.deviceId,
    trustedDevice: payload.device?.trusted ?? payload.trustedDevice ?? fallbackTrusted,
    mfaCompleted: payload.mfaCompleted ?? true
  };
  if (!result.tokens.refreshToken) {
    throw new AuthHttpError("Refresh token missing from response", 500, "server_error", {
      payload
    });
  }
  return result;
};

const toMfaRequired = (payload: LoginMfaPayload, request: PasswordLoginInput): LoginMfaRequiredResult => {
  return {
    challenge: {
      userId: payload.userId,
      deviceId: payload.deviceId ?? request.deviceId,
      identifier: request.identifier,
      deviceDisplayName: request.deviceDisplayName,
      devicePlatform: request.devicePlatform,
      methods: payload.methods.map((method) => ({
        id: method.id,
        type: method.type as MfaMethodType,
        label: method.label ?? null
      }))
    }
  };
};

const toMfaRequiredForGoogle = (payload: LoginMfaPayload, request: GoogleLoginInput): LoginMfaRequiredResult => {
  return {
    challenge: {
      userId: payload.userId,
      deviceId: payload.deviceId ?? request.deviceId,
      identifier: payload.userId ?? "",
      deviceDisplayName: request.deviceDisplayName,
      devicePlatform: request.devicePlatform,
      methods: payload.methods.map((method) => ({
        id: method.id,
        type: method.type as MfaMethodType,
        label: method.label ?? null
      }))
    }
  };
};

const toRegistrationResult = (payload: RegistrationPendingPayload): RegistrationRequestResult => {
  return {
    accepted: true,
    verificationExpiresAt: payload.verificationExpiresAt,
    resendAvailableAt: payload.resendAvailableAt,
    rateLimited: payload.rateLimited,
    captchaRequired: payload.captchaRequired
  };
};

export const createAuthHttpClient = (options: AuthHttpClientOptions = {}): AuthHttpClient => {
  const jsonFetch = createJsonFetcher(options);

  const request = async (input: JsonFetchOptions): Promise<Response> => {
    try {
      return await jsonFetch(input);
    } catch (error) {
      if (wasNetworkError(error)) {
        throw new AuthHttpError(error.message, 0, "network_error", { cause: error });
      }
      throw error;
    }
  };

  return {
    async loginWithPassword(input: PasswordLoginInput): Promise<LoginResult> {
      const response = await request({
        method: "POST",
        path: "/auth/login",
        body: {
          identifier: input.identifier,
          password: input.password,
          deviceId: input.deviceId,
          deviceDisplayName: input.deviceDisplayName,
          platform: input.devicePlatform,
          remember: input.rememberDevice,
          mfaCode: input.mfaCode,
          mfaMethodId: input.mfaMethodId
        },
        includeCredentials: true
      });

      if (response.ok) {
        const payload = (await readJson(response)) as LoginSuccessPayload;
        return toLoginSuccessResult(payload, input.rememberDevice);
      }

      const payload = await readJson(response);
      if (response.status === 401 && typeof payload === "object" && payload && "status" in payload && (payload as LoginMfaPayload).status === "mfa_required") {
        return toMfaRequired(payload as LoginMfaPayload, input);
      }

      if (response.status === 401) {
        throw new AuthHttpError("Invalid credentials", 401, mapErrorCode((payload as Record<string, unknown> | null)?.error));
      }

      throw new AuthHttpError("Authentication failed", response.status, mapErrorCode((payload as Record<string, unknown> | null)?.error), {
        retryAfterMs: toRetryAfter(response),
        payload
      });
    },

    async loginWithGoogle(input: GoogleLoginInput): Promise<LoginResult> {
      const response = await request({
        method: "POST",
        path: "/auth/google",
        body: {
          idToken: input.idToken,
          deviceId: input.deviceId,
          deviceDisplayName: input.deviceDisplayName,
          platform: input.devicePlatform,
          remember: input.rememberDevice,
          mfaCode: input.mfaCode,
          mfaMethodId: input.mfaMethodId
        },
        includeCredentials: true
      });

      if (response.ok) {
        const payload = (await readJson(response)) as LoginSuccessPayload;
        return toLoginSuccessResult(payload, input.rememberDevice);
      }

      const payload = await readJson(response);
      if (
        response.status === 401 &&
        typeof payload === "object" &&
        payload &&
        "status" in payload &&
        (payload as LoginMfaPayload).status === "mfa_required"
      ) {
        return toMfaRequiredForGoogle(payload as LoginMfaPayload, input);
      }

      throw new AuthHttpError("Google sign-in failed", response.status, mapErrorCode((payload as Record<string, unknown> | null)?.error), {
        retryAfterMs: toRetryAfter(response),
        payload
      });
    },

    async registerAccount(input: RegistrationRequestInput): Promise<RegistrationRequestResult> {
      const response = await request({
        method: "POST",
        path: "/auth/register",
        body: {
          identifier: input.identifier,
          password: input.password,
          remember: input.rememberDevice,
          deviceId: input.deviceId,
          deviceDisplayName: input.deviceDisplayName,
          platform: input.devicePlatform,
          locale: input.locale,
          consents: {
            termsAccepted: input.consents.termsAccepted,
            privacyAccepted: input.consents.privacyAccepted,
            marketingOptIn: input.consents.marketingOptIn ?? false
          }
        },
        includeCredentials: true
      });

      if (response.ok || response.status === 202) {
        const payload = (await readJson(response)) as RegistrationPendingPayload;
        if (payload && typeof payload === "object" && payload.status === "pending") {
          return toRegistrationResult(payload);
        }
        return {
          accepted: true
        };
      }

      const payload = await readJson(response);
      const code = mapErrorCode((payload as Record<string, unknown> | null)?.error);
      const messageFromPayload =
        typeof payload === "object" && payload && "message" in payload && typeof (payload as { message?: unknown }).message === "string"
          ? ((payload as { message?: string }).message as string)
          : undefined;
      const fallbackMessage = (() => {
        switch (code) {
          case "invalid_password":
            return "Password must meet the minimum strength requirements.";
          case "invalid_email":
            return "Enter a valid email address.";
          case "consent_required":
            return "Please accept the required policies to continue.";
          case "rate_limited":
            return "Too many attempts. Please wait a moment and try again.";
          default:
            return "Registration failed";
        }
      })();

      throw new AuthHttpError(messageFromPayload ?? fallbackMessage, response.status, code, {
        retryAfterMs: toRetryAfter(response),
        payload
      });
    },

    async verifyRegistration(input: RegistrationVerificationInput): Promise<LoginSuccessResult> {
      const response = await request({
        method: "POST",
        path: "/auth/register/verify",
        body: {
          token: input.token,
          remember: input.rememberDevice,
          deviceId: input.deviceId,
          deviceDisplayName: input.deviceDisplayName,
          platform: input.devicePlatform
        },
        includeCredentials: true
      });

      if (response.ok) {
        const payload = (await readJson(response)) as LoginSuccessPayload;
        return toLoginSuccessResult(payload, input.rememberDevice);
      }

      const payload = await readJson(response);
      throw new AuthHttpError("Verification failed", response.status, mapErrorCode((payload as Record<string, unknown> | null)?.error), {
        retryAfterMs: toRetryAfter(response),
        payload
      });
    },

    async resendRegistration(input: RegistrationResendInput): Promise<RegistrationResendResult> {
      const response = await request({
        method: "POST",
        path: "/auth/register/resend",
        body: {
          identifier: input.identifier
        },
        includeCredentials: true
      });

      if (response.ok || response.status === 202) {
        const payload = (await readJson(response)) as RegistrationPendingPayload;
        if (payload && typeof payload === "object" && payload.status === "pending") {
          return toRegistrationResult(payload);
        }
        return {
          accepted: true
        };
      }

      const payload = await readJson(response);
      throw new AuthHttpError("Resend failed", response.status, mapErrorCode((payload as Record<string, unknown> | null)?.error), {
        retryAfterMs: toRetryAfter(response),
        payload
      });
    },

    async refresh(input?: { refreshToken?: string }): Promise<RefreshResult> {
      const response = await request({
        method: "POST",
        path: "/auth/refresh",
        body: input?.refreshToken ? { refreshToken: input.refreshToken } : undefined,
        includeCredentials: true
      });

      if (!response.ok) {
        const payload = await readJson(response);
        throw new AuthHttpError("Refresh failed", response.status, mapErrorCode((payload as Record<string, unknown> | null)?.error), {
          retryAfterMs: toRetryAfter(response),
          payload
        });
      }

      const payload = (await readJson(response)) as LoginSuccessPayload;
      const result = {
        tokens: {
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken ?? "",
          issuedAt: payload.issuedAt,
          expiresAt: payload.expiresAt
        },
        refreshExpiresAt: payload.refreshExpiresAt,
        syncToken: payload.syncToken ?? null,
        ...normaliseClaims(decodeJwtClaims(payload.accessToken))
      } satisfies RefreshResult;
      if (!result.tokens.refreshToken) {
        throw new AuthHttpError("Refresh token missing from response", response.status, "server_error", {
          payload
        });
      }
      return result;
    },

    async logout(accessToken: string): Promise<void> {
      const response = await request({
        method: "POST",
        path: "/auth/logout",
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        includeCredentials: true
      });

      if (!response.ok && response.status !== 401) {
        const payload = await readJson(response);
        throw new AuthHttpError("Logout failed", response.status, mapErrorCode((payload as Record<string, unknown> | null)?.error), {
          payload
        });
      }
    },

    async logoutAll(accessToken: string): Promise<void> {
      const response = await request({
        method: "POST",
        path: "/auth/logout-all",
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        includeCredentials: true
      });

      if (!response.ok && response.status !== 401) {
        const payload = await readJson(response);
        throw new AuthHttpError("Logout-all failed", response.status, mapErrorCode((payload as Record<string, unknown> | null)?.error), {
          payload
        });
      }
    },

    async requestPasswordReset(input: PasswordResetRequestInput): Promise<ForgotPasswordResult> {
      const response = await request({
        method: "POST",
        path: "/auth/forgot",
        body: { identifier: input.identifier },
        includeCredentials: true
      });

      if (response.ok) {
        return { accepted: true } satisfies ForgotPasswordResult;
      }

      const payload = await readJson(response);
      const code = mapErrorCode((payload as Record<string, unknown> | null)?.status ?? (payload as Record<string, unknown> | null)?.error);
      if (response.status === 429) {
        return { accepted: false, rateLimited: true } satisfies ForgotPasswordResult;
      }
      if (code === "captcha_required") {
        return { accepted: false, captchaRequired: true } satisfies ForgotPasswordResult;
      }
      throw new AuthHttpError("Password reset request failed", response.status, code, {
        retryAfterMs: toRetryAfter(response),
        payload
      });
    },

    async submitPasswordReset(input: PasswordResetSubmissionInput): Promise<ResetPasswordResult> {
      const response = await request({
        method: "POST",
        path: "/auth/reset",
        body: { token: input.token, password: input.password },
        includeCredentials: true
      });

      if (response.ok) {
        return { success: true } satisfies ResetPasswordResult;
      }
      const payload = await readJson(response);
      const code = mapErrorCode((payload as Record<string, unknown> | null)?.error);
      if (response.status === 400 && code === "invalid_token") {
        return { success: false, errorCode: "invalid_token" } satisfies ResetPasswordResult;
      }
      throw new AuthHttpError("Password reset failed", response.status, code, {
        payload
      });
    },

    async listSessions(accessToken: string): Promise<SessionsListResult> {
      const response = await request({
        method: "GET",
        path: "/auth/sessions",
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        includeCredentials: true
      });

      if (response.status === 404) {
        return { sessions: [] } satisfies SessionsListResult;
      }

      if (!response.ok) {
        const payload = await readJson(response);
        throw new AuthHttpError("Failed to load sessions", response.status, mapErrorCode((payload as Record<string, unknown> | null)?.error), {
          payload
        });
      }

      const payload = await readJson(response);
      if (!payload || typeof payload !== "object" || !Array.isArray((payload as Record<string, unknown>).sessions)) {
        throw new AuthHttpError("Invalid session payload", response.status, "server_error", {
          payload
        });
      }

      const sessions = ((payload as { sessions: unknown }).sessions as ReadonlyArray<Record<string, unknown>>).map((session) => {
        const deviceSource =
          session.device && typeof session.device === "object"
            ? (session.device as Record<string, unknown>)
            : {};
        const metadataSource =
          session.metadata && typeof session.metadata === "object"
            ? (session.metadata as Record<string, unknown>)
            : null;
        const deviceLastSeen = deviceSource.lastSeenAt ?? session.lastSeenAt ?? Date.now();

        return {
          id: String(session.id ?? ""),
          device: {
            deviceId: String(deviceSource.id ?? session.deviceId ?? ""),
            displayName: String(deviceSource.displayName ?? session.deviceDisplayName ?? "Unknown device"),
            platform: String(deviceSource.platform ?? session.platform ?? "unknown"),
            trusted: Boolean(deviceSource.trusted ?? session.trusted ?? false),
            lastSeenAt: Number(deviceLastSeen)
          },
          createdAt: Number(session.createdAt ?? Date.now()),
          expiresAt: Number(session.expiresAt ?? Date.now()),
          lastActiveAt: Number(session.lastActiveAt ?? deviceLastSeen ?? Date.now()),
          current: Boolean(session.current ?? false),
          ipAddress: typeof session.ipAddress === "string" ? session.ipAddress : null,
          userAgent: typeof session.userAgent === "string" ? session.userAgent : null,
          metadata: metadataSource
        } satisfies SessionsListResult["sessions"][number];
      });

      return { sessions } satisfies SessionsListResult;
    },

    async revokeSession(accessToken: string, sessionId: string): Promise<void> {
      const response = await request({
        method: "POST",
        path: "/auth/sessions/revoke",
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        body: { sessionId },
        includeCredentials: true
      });

      if (!response.ok) {
        const payload = await readJson(response);
        throw new AuthHttpError("Failed to revoke session", response.status, mapErrorCode((payload as Record<string, unknown> | null)?.error), {
          payload
        });
      }
    }
  } satisfies AuthHttpClient;
};
