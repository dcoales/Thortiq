/**
 * Shared auth store types bridging platforms. These types avoid referencing platform-specific APIs
 * (React, browser storage, etc.) so both web and native adapters can orchestrate the authentication
 * lifecycle consistently.  The store exposes a deterministic state machine that surfaces only the
 * data UI layers require (user profile, challenge prompts, session metadata) while keeping refresh
 * tokens and other sensitive values encapsulated inside the store implementation.
 */
import type {
  DeviceId,
  MfaMethodId,
  MfaMethodType,
  SessionId,
  Timestamp,
  TokenPair,
  UserId,
  UserProfile
} from "./types";

export type AuthStatus =
  | "initializing"
  | "unauthenticated"
  | "authenticating"
  | "authenticated"
  | "mfa_required"
  | "recovering"
  | "error";

export type AuthMethod = "password" | "google" | "refresh";

export type AuthErrorCode =
  | "network_error"
  | "invalid_credentials"
  | "server_error"
  | "rate_limited"
  | "captcha_required"
  | "session_revoked"
  | "invalid_token"
  | "unknown";

export interface AuthErrorState {
  readonly code: AuthErrorCode;
  readonly message?: string;
  readonly retryAfterMs?: number;
  readonly cause?: unknown;
}

export interface AuthSessionSnapshot {
  readonly user: UserProfile;
  readonly sessionId: SessionId;
  readonly deviceId: DeviceId;
  readonly deviceDisplayName: string;
  readonly devicePlatform: string;
  readonly trustedDevice: boolean;
  readonly rememberDevice: boolean;
  readonly accessTokenExpiresAt: Timestamp;
  readonly refreshTokenExpiresAt: Timestamp;
  readonly issuedAt: Timestamp;
  readonly offline: boolean;
  readonly mfaCompleted: boolean;
}

export interface SessionDeviceSnapshot {
  readonly deviceId: DeviceId;
  readonly displayName: string;
  readonly platform: string;
  readonly trusted: boolean;
  readonly lastSeenAt: Timestamp;
}

export interface SessionSummary {
  readonly id: SessionId;
  readonly device: SessionDeviceSnapshot;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly lastActiveAt: Timestamp;
  readonly current: boolean;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export interface MfaChallengeMethod {
  readonly id: MfaMethodId;
  readonly type: MfaMethodType;
  readonly label?: string | null;
}

export interface MfaChallengeState {
  readonly userId?: UserId;
  readonly deviceId?: DeviceId;
  readonly identifier: string;
  readonly deviceDisplayName: string;
  readonly devicePlatform: string;
  readonly methods: ReadonlyArray<MfaChallengeMethod>;
}

export interface AuthInitializingState {
  readonly status: "initializing";
  readonly rememberDevice: boolean;
}

export interface AuthUnauthenticatedState {
  readonly status: "unauthenticated";
  readonly rememberDevice: boolean;
  readonly lastIdentifier?: string;
  readonly error?: AuthErrorState;
}

export interface AuthAuthenticatingState {
  readonly status: "authenticating";
  readonly rememberDevice: boolean;
  readonly method: AuthMethod;
  readonly identifier?: string;
}

export interface AuthMfaRequiredState {
  readonly status: "mfa_required";
  readonly rememberDevice: boolean;
  readonly challenge: MfaChallengeState;
}

export interface AuthAuthenticatedState {
  readonly status: "authenticated";
  readonly rememberDevice: boolean;
  readonly session: AuthSessionSnapshot;
  readonly sessions?: ReadonlyArray<SessionSummary>;
}

export interface AuthRecoveringState {
  readonly status: "recovering";
  readonly rememberDevice: boolean;
  readonly stage: "request" | "reset";
  readonly identifier?: string;
  readonly pendingToken?: string;
}

export interface AuthErrorStatusState {
  readonly status: "error";
  readonly rememberDevice: boolean;
  readonly error: AuthErrorState;
}

export type AuthState =
  | AuthInitializingState
  | AuthUnauthenticatedState
  | AuthAuthenticatingState
  | AuthMfaRequiredState
  | AuthAuthenticatedState
  | AuthRecoveringState
  | AuthErrorStatusState;

export interface PasswordLoginInput {
  readonly identifier: string;
  readonly password: string;
  readonly rememberDevice: boolean;
  readonly deviceDisplayName: string;
  readonly devicePlatform: string;
  readonly deviceId?: DeviceId;
  readonly mfaCode?: string;
  readonly mfaMethodId?: MfaMethodId;
}

export interface GoogleLoginInput {
  readonly idToken: string;
  readonly rememberDevice: boolean;
  readonly deviceDisplayName: string;
  readonly devicePlatform: string;
  readonly deviceId?: DeviceId;
}

export interface PasswordResetRequestInput {
  readonly identifier: string;
}

export interface PasswordResetSubmissionInput {
  readonly token: string;
  readonly password: string;
}

export interface StoredAuthSession {
  readonly sessionId: SessionId;
  readonly user: UserProfile;
  readonly tokens: TokenPair;
  readonly refreshExpiresAt: Timestamp;
  readonly deviceId: DeviceId;
  readonly deviceDisplayName: string;
  readonly devicePlatform: string;
  readonly rememberDevice: boolean;
  readonly trustedDevice: boolean;
  readonly mfaCompleted: boolean;
  readonly cachedAt: Timestamp;
}

export interface AuthSessionSecrets {
  readonly sessionId: SessionId;
  readonly deviceId: DeviceId;
  readonly deviceDisplayName: string;
  readonly devicePlatform: string;
  readonly tokens: TokenPair;
  readonly refreshExpiresAt: Timestamp;
  readonly trustedDevice: boolean;
  readonly rememberDevice: boolean;
  readonly mfaCompleted: boolean;
  readonly user: UserProfile;
}

export interface RefreshResult {
  readonly tokens: TokenPair;
  readonly refreshExpiresAt: Timestamp;
  readonly sessionId?: SessionId;
  readonly deviceId?: DeviceId;
}

export interface LoginSuccessResult {
  readonly user: UserProfile;
  readonly tokens: TokenPair;
  readonly refreshExpiresAt: Timestamp;
  readonly sessionId?: SessionId;
  readonly deviceId?: DeviceId;
  readonly trustedDevice: boolean;
  readonly mfaCompleted: boolean;
}

export interface LoginMfaRequiredResult {
  readonly challenge: MfaChallengeState;
}

export type LoginResult = LoginSuccessResult | LoginMfaRequiredResult;

export interface GoogleLoginResult extends LoginSuccessResult {}

export interface ForgotPasswordResult {
  readonly accepted: boolean;
  readonly rateLimited?: boolean;
  readonly captchaRequired?: boolean;
}

export interface ResetPasswordResult {
  readonly success: boolean;
  readonly errorCode?: AuthErrorCode;
}

export interface SessionsListResult {
  readonly sessions: ReadonlyArray<SessionSummary>;
}
