import type {
  AuditLogEntry,
  CredentialRecord,
  CredentialType,
  DeviceRecord,
  GoogleIdTokenPayload,
  MfaMethodRecord,
  OAuthProviderLink,
  PasswordResetRecord,
  SessionRecord,
  UserProfile
} from "@thortiq/client-core";

export interface RegistrationConsentsRecord {
  readonly termsAccepted: boolean;
  readonly privacyAccepted: boolean;
  readonly marketingOptIn?: boolean;
}

export interface RegistrationRecord {
  readonly id: string;
  readonly identifier: string;
  readonly tokenHash: string;
  readonly passwordHash: string;
  readonly consents: RegistrationConsentsRecord;
  readonly rememberDevice: boolean;
  readonly deviceDisplayName: string | null;
  readonly devicePlatform: string | null;
  readonly deviceId: string | null;
  readonly locale: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt: number;
  readonly lastSentAt: number;
  readonly resendAvailableAt: number;
  readonly attempts: number;
  readonly completedAt: number | null;
}

export interface CreateUserInput {
  readonly user: UserProfile;
  readonly credential?: CredentialRecord | null;
  readonly googleLink?: OAuthProviderLink | null;
}

export interface UpsertDeviceInput {
  readonly device: DeviceRecord;
}

export interface CreateSessionInput {
  readonly session: SessionRecord;
}

export interface UpdateSessionRefreshInput {
  readonly sessionId: string;
  readonly refreshTokenHash: string;
  readonly expiresAt: number;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export interface CreatePasswordResetInput {
  readonly reset: PasswordResetRecord;
}

export interface CreateAuditLogInput {
  readonly entry: AuditLogEntry;
}

export interface OAuthLinkUpsert {
  readonly link: OAuthProviderLink;
}

export interface IdentityStore {
  getUserByEmail(email: string): Promise<UserProfile | null>;
  getUserById(userId: string): Promise<UserProfile | null>;
  getCredentialByUser(userId: string, type: CredentialType): Promise<CredentialRecord | null>;
  upsertCredential(credential: CredentialRecord): Promise<void>;
  createUser(input: CreateUserInput): Promise<void>;
  upsertDevice(input: UpsertDeviceInput): Promise<DeviceRecord>;
  getDeviceById(deviceId: string): Promise<DeviceRecord | null>;
  updateDeviceLastSeen(deviceId: string, timestamp: number, metadata?: Readonly<Record<string, unknown>> | null): Promise<void>;
  createSession(input: CreateSessionInput): Promise<SessionRecord>;
  updateSessionRefresh(input: UpdateSessionRefreshInput): Promise<void>;
  getSessionById(sessionId: string): Promise<SessionRecord | null>;
  getSessionByRefreshHash(hash: string): Promise<SessionRecord | null>;
  revokeSession(sessionId: string, revokedAt: number): Promise<void>;
  revokeSessionsByUser(userId: string, revokedAt: number): Promise<void>;
  listActiveSessions(userId: string): Promise<ReadonlyArray<SessionRecord>>;
  createPasswordReset(input: CreatePasswordResetInput): Promise<PasswordResetRecord>;
  getPasswordResetByTokenHash(hash: string): Promise<PasswordResetRecord | null>;
  markPasswordResetUsed(resetId: string, usedAt: number): Promise<void>;
  createAuditLog(input: CreateAuditLogInput): Promise<void>;
  getOAuthLinkBySubject(provider: string, subject: string): Promise<OAuthProviderLink | null>;
  getOAuthLinkByUser(provider: string, userId: string): Promise<OAuthProviderLink | null>;
  upsertOAuthLink(input: OAuthLinkUpsert): Promise<void>;
  getMfaMethodsByUser(userId: string): Promise<ReadonlyArray<MfaMethodRecord>>;
  createOrUpdateMfaMethod(method: MfaMethodRecord): Promise<void>;
  removeMfaMethod(methodId: string): Promise<void>;
  createOrUpdateUserProfile(user: UserProfile): Promise<UserProfile>;
  getCredentialById(credentialId: string): Promise<CredentialRecord | null>;
  listCredentialsByUser(userId: string, type: CredentialType): Promise<ReadonlyArray<CredentialRecord>>;
  removeCredential(credentialId: string): Promise<void>;
  getRegistrationByIdentifier(identifier: string): Promise<RegistrationRecord | null>;
  getRegistrationByTokenHash(hash: string): Promise<RegistrationRecord | null>;
  upsertRegistration(record: RegistrationRecord): Promise<void>;
  markRegistrationCompleted(registrationId: string, completedAt: number): Promise<void>;
  deleteRegistration(registrationId: string): Promise<void>;
}

export interface GoogleAccountLinkResult {
  readonly profile: UserProfile;
  readonly credential: CredentialRecord | null;
  readonly link: OAuthProviderLink;
  readonly payload: GoogleIdTokenPayload;
}
