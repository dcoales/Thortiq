/**
 * Shared authentication and identity contracts consumed by both client adapters and servers.
 * These types intentionally avoid implementation details (hashing algorithms, database engines)
 * so platforms can adopt consistent policies while retaining flexibility for future providers.
 */

export type UserId = string;
export type DeviceId = string;
export type SessionId = string;
export type CredentialId = string;
export type OAuthLinkId = string;
export type MfaMethodId = string;
export type PasswordResetId = string;
export type AuditLogId = string;

export type Timestamp = number;

export type CredentialType = "password" | "magic-link" | "webauthn" | "service-token";

export type OAuthProvider = "google";

export type MfaMethodType = "totp" | "webauthn" | "backup-codes";

export interface UserProfile {
  readonly id: UserId;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly displayName: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly deletedAt?: Timestamp | null;
  readonly locale?: string | null;
}

export interface CredentialRecord {
  readonly id: CredentialId;
  readonly userId: UserId;
  readonly type: CredentialType;
  readonly hash: string;
  readonly salt?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly revokedAt?: Timestamp | null;
}

export interface OAuthProviderLink {
  readonly id: OAuthLinkId;
  readonly userId: UserId;
  readonly provider: OAuthProvider;
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly accessToken?: string | null;
  readonly refreshToken?: string | null;
  readonly scopes?: ReadonlyArray<string> | null;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly revokedAt?: Timestamp | null;
}

export interface SessionRecord {
  readonly id: SessionId;
  readonly userId: UserId;
  readonly deviceId: DeviceId;
  readonly refreshTokenHash: string;
  readonly userAgent?: string | null;
  readonly ipAddress?: string | null;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly revokedAt?: Timestamp | null;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export interface DeviceRecord {
  readonly id: DeviceId;
  readonly userId: UserId;
  readonly displayName: string;
  readonly platform: string;
  readonly createdAt: Timestamp;
  readonly lastSeenAt: Timestamp;
  readonly trusted: boolean;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export interface MfaMethodRecord {
  readonly id: MfaMethodId;
  readonly userId: UserId;
  readonly type: MfaMethodType;
  readonly secret: string | null;
  readonly label?: string | null;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly verifiedAt?: Timestamp | null;
  readonly disabledAt?: Timestamp | null;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export interface PasswordResetRecord {
  readonly id: PasswordResetId;
  readonly userId: UserId;
  readonly tokenHash: string;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly usedAt?: Timestamp | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface AuditLogEntry {
  readonly id: AuditLogId;
  readonly userId: UserId | null;
  readonly eventType: string;
  readonly createdAt: Timestamp;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly issuedAt: Timestamp;
  readonly expiresAt: Timestamp;
}

export interface TokenClaims {
  readonly sub: UserId;
  readonly sessionId: SessionId;
  readonly deviceId: DeviceId;
  readonly exp: number;
  readonly iat: number;
  readonly scope?: string;
  readonly mfa?: boolean;
}

export interface GoogleIdTokenPayload {
  readonly iss: string;
  readonly sub: string;
  readonly email: string;
  readonly email_verified: boolean;
  readonly aud: string;
  readonly exp: number;
  readonly iat: number;
  readonly picture?: string;
  readonly given_name?: string;
  readonly family_name?: string;
  readonly hd?: string;
}

export interface AuthEnvironmentConfig {
  readonly jwtIssuer: string;
  readonly jwtAudience: string;
  readonly accessTokenLifetimeSeconds: number;
  readonly refreshTokenLifetimeSeconds: number;
  readonly trustedDeviceLifetimeSeconds: number;
}
