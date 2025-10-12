import DatabaseConstructor from "better-sqlite3";

type BetterSqliteDatabase = InstanceType<typeof DatabaseConstructor>;

import type {
  CredentialRecord,
  CredentialType,
  DeviceRecord,
  MfaMethodRecord,
  MfaMethodType,
  OAuthProvider,
  OAuthProviderLink,
  PasswordResetRecord,
  SessionRecord,
  UserProfile
} from "@thortiq/client-core";

import { INITIAL_MIGRATION, applyMigration } from "../db";

import type {
  CreateAuditLogInput,
  CreatePasswordResetInput,
  CreateSessionInput,
  CreateUserInput,
  IdentityStore,
  OAuthLinkUpsert,
  RegistrationRecord,
  UpdateSessionRefreshInput,
  UpsertDeviceInput
} from "./types";

const parseJsonColumn = <T>(value: string | null | undefined): T | null => {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch (_error) {
    return null;
  }
};

const serializeJsonColumn = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.stringify(value);
};

interface UserRow {
  id: string;
  email: string;
  email_verified: number;
  display_name: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  locale: string | null;
}

interface CredentialRow {
  id: string;
  user_id: string;
  type: string;
  hash: string;
  salt: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
  revoked_at: number | null;
}

interface DeviceRow {
  id: string;
  user_id: string;
  display_name: string;
  platform: string;
  trusted: number;
  metadata: string | null;
  created_at: number;
  last_seen_at: number;
}

interface SessionRow {
  id: string;
  user_id: string;
  device_id: string;
  refresh_token_hash: string;
  user_agent: string | null;
  ip_address: string | null;
  metadata: string | null;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

interface PasswordResetRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  ip_address: string | null;
  user_agent: string | null;
}

interface OAuthProviderRow {
  id: string;
  user_id: string;
  provider: string;
  subject: string;
  email: string;
  email_verified: number;
  access_token: string | null;
  refresh_token: string | null;
  scopes: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
  revoked_at: number | null;
}

interface MfaMethodRow {
  id: string;
  user_id: string;
  type: string;
  secret: string | null;
  label: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
  verified_at: number | null;
  disabled_at: number | null;
}

interface RegistrationRow {
  id: string;
  identifier: string;
  token_hash: string;
  password_hash: string;
  consents: string | null;
  remember_device: number;
  device_display_name: string | null;
  device_platform: string | null;
  device_id: string | null;
  locale: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
  last_sent_at: number;
  resend_available_at: number;
  attempts: number;
  completed_at: number | null;
}

const toUserProfile = (row: UserRow): UserProfile => {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified === 1,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
    locale: row.locale ?? null
  };
};

const toCredentialRecord = (row: CredentialRow): CredentialRecord => {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as CredentialType,
    hash: row.hash,
    salt: row.salt ?? null,
    metadata: parseJsonColumn(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at ?? null
  };
};

const toDeviceRecord = (row: DeviceRow): DeviceRecord => {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    platform: row.platform,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    trusted: row.trusted === 1,
    metadata: parseJsonColumn(row.metadata)
  };
};

const toSessionRecord = (row: SessionRow): SessionRecord => {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    refreshTokenHash: row.refresh_token_hash,
    userAgent: row.user_agent ?? null,
    ipAddress: row.ip_address ?? null,
    metadata: parseJsonColumn(row.metadata),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at ?? null
  };
};

const toPasswordResetRecord = (row: PasswordResetRow): PasswordResetRecord => {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at ?? null,
    ipAddress: row.ip_address ?? null,
    userAgent: row.user_agent ?? null
  };
};

const toOAuthLinkRecord = (row: OAuthProviderRow): OAuthProviderLink => {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider as OAuthProvider,
    subject: row.subject,
    email: row.email,
    emailVerified: row.email_verified === 1,
    accessToken: row.access_token ?? null,
    refreshToken: row.refresh_token ?? null,
    scopes: parseJsonColumn(row.scopes),
    metadata: parseJsonColumn(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at ?? null
  };
};

const toMfaMethodRecord = (row: MfaMethodRow): MfaMethodRecord => {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as MfaMethodType,
    secret: row.secret ?? null,
    label: row.label ?? null,
    metadata: parseJsonColumn(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    verifiedAt: row.verified_at ?? null,
    disabledAt: row.disabled_at ?? null
  };
};

const toRegistrationRecord = (row: RegistrationRow): RegistrationRecord => {
  const consents = parseJsonColumn<RegistrationRecord["consents"]>(row.consents);
  return {
    id: row.id,
    identifier: row.identifier,
    tokenHash: row.token_hash,
    passwordHash: row.password_hash,
    consents:
      consents ??
      ({
        termsAccepted: false,
        privacyAccepted: false
      } satisfies RegistrationRecord["consents"]),
    rememberDevice: row.remember_device === 1,
    deviceDisplayName: row.device_display_name ?? null,
    devicePlatform: row.device_platform ?? null,
    deviceId: row.device_id ?? null,
    locale: row.locale ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    lastSentAt: row.last_sent_at,
    resendAvailableAt: row.resend_available_at,
    attempts: row.attempts,
    completedAt: row.completed_at ?? null
  };
};

export interface SqliteIdentityStoreOptions {
  readonly path: string;
}

export class SqliteIdentityStore implements IdentityStore {
  private readonly db: BetterSqliteDatabase;

  constructor(options: SqliteIdentityStoreOptions) {
    this.db = new DatabaseConstructor(options.path);
    this.db.pragma("foreign_keys = ON");
    applyMigration(INITIAL_MIGRATION, {
      exec: (statement: string) => {
        this.db.prepare(statement).run();
      }
    });
  }

  close(): void {
    this.db.close();
  }

  async getUserByEmail(email: string): Promise<UserProfile | null> {
    const stmt = this.db.prepare(
      `
      SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1
    `
    );
    const row = stmt.get(email) as UserRow | undefined;
    return row ? toUserProfile(row) : null;
  }

  async getUserById(userId: string): Promise<UserProfile | null> {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(userId) as UserRow | undefined;
    return row ? toUserProfile(row) : null;
  }

  async getCredentialByUser(userId: string, type: CredentialType): Promise<CredentialRecord | null> {
    const row = this.db
      .prepare("SELECT * FROM credentials WHERE user_id = ? AND type = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1")
      .get(userId, type) as CredentialRow | undefined;
    return row ? toCredentialRecord(row) : null;
  }

  async getCredentialById(credentialId: string): Promise<CredentialRecord | null> {
    const row = this.db.prepare("SELECT * FROM credentials WHERE id = ? LIMIT 1").get(credentialId) as CredentialRow | undefined;
    return row ? toCredentialRecord(row) : null;
  }

  async listCredentialsByUser(userId: string, type: CredentialType): Promise<ReadonlyArray<CredentialRecord>> {
    const rows = this.db
      .prepare("SELECT * FROM credentials WHERE user_id = ? AND type = ? AND revoked_at IS NULL ORDER BY created_at ASC")
      .all(userId, type) as CredentialRow[];
    return rows.map(toCredentialRecord);
  }

  async upsertCredential(credential: CredentialRecord): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO credentials (id, user_id, type, hash, salt, metadata, created_at, updated_at, revoked_at)
        VALUES (@id, @user_id, @type, @hash, @salt, @metadata, @created_at, @updated_at, @revoked_at)
        ON CONFLICT(id) DO UPDATE SET
          hash = excluded.hash,
          salt = excluded.salt,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at,
          revoked_at = excluded.revoked_at
      `
      )
      .run({
        id: credential.id,
        user_id: credential.userId,
        type: credential.type,
        hash: credential.hash,
        salt: credential.salt ?? null,
        metadata: serializeJsonColumn(credential.metadata),
        created_at: credential.createdAt,
        updated_at: credential.updatedAt,
        revoked_at: credential.revokedAt ?? null
      });
  }

  async removeCredential(credentialId: string): Promise<void> {
    this.db
      .prepare(
        `
        UPDATE credentials
        SET revoked_at = COALESCE(revoked_at, ?)
        WHERE id = ?
      `
      )
      .run(Date.now(), credentialId);
  }

  async getRegistrationByIdentifier(identifier: string): Promise<RegistrationRecord | null> {
    const row = this.db
      .prepare("SELECT * FROM registrations WHERE LOWER(identifier) = LOWER(?) LIMIT 1")
      .get(identifier) as RegistrationRow | undefined;
    return row ? toRegistrationRecord(row) : null;
  }

  async getRegistrationByTokenHash(hash: string): Promise<RegistrationRecord | null> {
    const row = this.db
      .prepare("SELECT * FROM registrations WHERE token_hash = ? LIMIT 1")
      .get(hash) as RegistrationRow | undefined;
    return row ? toRegistrationRecord(row) : null;
  }

  async upsertRegistration(record: RegistrationRecord): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO registrations (
          id,
          identifier,
          token_hash,
          password_hash,
          consents,
          remember_device,
          device_display_name,
          device_platform,
          device_id,
          locale,
          created_at,
          updated_at,
          expires_at,
          last_sent_at,
          resend_available_at,
          attempts,
          completed_at
        ) VALUES (
          @id,
          @identifier,
          @token_hash,
          @password_hash,
          @consents,
          @remember_device,
          @device_display_name,
          @device_platform,
          @device_id,
          @locale,
          @created_at,
          @updated_at,
          @expires_at,
          @last_sent_at,
          @resend_available_at,
          @attempts,
          @completed_at
        )
        ON CONFLICT(id) DO UPDATE SET
          identifier = excluded.identifier,
          token_hash = excluded.token_hash,
          password_hash = excluded.password_hash,
          consents = excluded.consents,
          remember_device = excluded.remember_device,
          device_display_name = excluded.device_display_name,
          device_platform = excluded.device_platform,
          device_id = excluded.device_id,
          locale = excluded.locale,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at,
          last_sent_at = excluded.last_sent_at,
          resend_available_at = excluded.resend_available_at,
          attempts = excluded.attempts,
          completed_at = excluded.completed_at
      `
      )
      .run({
        id: record.id,
        identifier: record.identifier,
        token_hash: record.tokenHash,
        password_hash: record.passwordHash,
        consents: serializeJsonColumn(record.consents),
        remember_device: record.rememberDevice ? 1 : 0,
        device_display_name: record.deviceDisplayName ?? null,
        device_platform: record.devicePlatform ?? null,
        device_id: record.deviceId ?? null,
        locale: record.locale ?? null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        expires_at: record.expiresAt,
        last_sent_at: record.lastSentAt,
        resend_available_at: record.resendAvailableAt,
        attempts: record.attempts,
        completed_at: record.completedAt ?? null
      });
  }

  async markRegistrationCompleted(registrationId: string, completedAt: number): Promise<void> {
    this.db
      .prepare(
        `
        UPDATE registrations
        SET completed_at = @completed_at,
            updated_at = @updated_at
        WHERE id = @id
      `
      )
      .run({
        id: registrationId,
        completed_at: completedAt,
        updated_at: completedAt
      });
  }

  async deleteRegistration(registrationId: string): Promise<void> {
    this.db.prepare("DELETE FROM registrations WHERE id = ?").run(registrationId);
  }

  async createUser(input: CreateUserInput): Promise<void> {
    const insertUser = this.db.prepare(
      `
      INSERT INTO users (id, email, email_verified, display_name, created_at, updated_at, deleted_at, locale)
      VALUES (@id, @email, @email_verified, @display_name, @created_at, @updated_at, @deleted_at, @locale)
    `
    );

    const insertCredential = input.credential
      ? this.db.prepare(
          `
        INSERT INTO credentials (id, user_id, type, hash, salt, metadata, created_at, updated_at, revoked_at)
        VALUES (@id, @user_id, @type, @hash, @salt, @metadata, @created_at, @updated_at, @revoked_at)
      `
        )
      : null;

    const insertOAuth = input.googleLink
      ? this.db.prepare(
          `
        INSERT INTO oauth_providers (id, user_id, provider, subject, email, email_verified, access_token, refresh_token, scopes, metadata, created_at, updated_at, revoked_at)
        VALUES (@id, @user_id, @provider, @subject, @email, @email_verified, @access_token, @refresh_token, @scopes, @metadata, @created_at, @updated_at, @revoked_at)
      `
        )
      : null;

    this.db.transaction(() => {
      insertUser.run({
        id: input.user.id,
        email: input.user.email,
        email_verified: input.user.emailVerified ? 1 : 0,
        display_name: input.user.displayName,
        created_at: input.user.createdAt,
        updated_at: input.user.updatedAt,
        deleted_at: input.user.deletedAt ?? null,
        locale: input.user.locale ?? null
      });

      if (insertCredential && input.credential) {
        insertCredential.run({
          id: input.credential.id,
          user_id: input.credential.userId,
          type: input.credential.type,
          hash: input.credential.hash,
          salt: input.credential.salt ?? null,
          metadata: serializeJsonColumn(input.credential.metadata),
          created_at: input.credential.createdAt,
          updated_at: input.credential.updatedAt,
          revoked_at: input.credential.revokedAt ?? null
        });
      }

      if (insertOAuth && input.googleLink) {
        insertOAuth.run({
          id: input.googleLink.id,
          user_id: input.googleLink.userId,
          provider: input.googleLink.provider,
          subject: input.googleLink.subject,
          email: input.googleLink.email,
          email_verified: input.googleLink.emailVerified ? 1 : 0,
          access_token: input.googleLink.accessToken ?? null,
          refresh_token: input.googleLink.refreshToken ?? null,
          scopes: serializeJsonColumn(input.googleLink.scopes),
          metadata: serializeJsonColumn(input.googleLink.metadata),
          created_at: input.googleLink.createdAt,
          updated_at: input.googleLink.updatedAt,
          revoked_at: input.googleLink.revokedAt ?? null
        });
      }
    })();
  }

  async upsertDevice(input: UpsertDeviceInput): Promise<DeviceRecord> {
    this.db
      .prepare(
        `
        INSERT INTO devices (id, user_id, display_name, platform, trusted, metadata, created_at, last_seen_at)
        VALUES (@id, @user_id, @display_name, @platform, @trusted, @metadata, @created_at, @last_seen_at)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          platform = excluded.platform,
          trusted = excluded.trusted,
          metadata = excluded.metadata,
          last_seen_at = excluded.last_seen_at
      `
      )
      .run({
        id: input.device.id,
        user_id: input.device.userId,
        display_name: input.device.displayName,
        platform: input.device.platform,
        trusted: input.device.trusted ? 1 : 0,
        metadata: serializeJsonColumn(input.device.metadata),
        created_at: input.device.createdAt,
        last_seen_at: input.device.lastSeenAt
      });

    const row = this.db.prepare("SELECT * FROM devices WHERE id = ? LIMIT 1").get(input.device.id) as DeviceRow | undefined;
    if (!row) {
      throw new Error("Failed to load device after upsert");
    }
    return toDeviceRecord(row);
  }

  async getDeviceById(deviceId: string): Promise<DeviceRecord | null> {
    const row = this.db.prepare("SELECT * FROM devices WHERE id = ? LIMIT 1").get(deviceId) as DeviceRow | undefined;
    return row ? toDeviceRecord(row) : null;
  }

  async updateDeviceLastSeen(deviceId: string, timestamp: number, metadata?: Readonly<Record<string, unknown>> | null): Promise<void> {
    this.db
      .prepare("UPDATE devices SET last_seen_at = ?, metadata = COALESCE(?, metadata) WHERE id = ?")
      .run(timestamp, serializeJsonColumn(metadata ?? null), deviceId);
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    this.db
      .prepare(
        `
        INSERT INTO sessions (id, user_id, device_id, refresh_token_hash, user_agent, ip_address, metadata, created_at, expires_at, revoked_at)
        VALUES (@id, @user_id, @device_id, @refresh_token_hash, @user_agent, @ip_address, @metadata, @created_at, @expires_at, @revoked_at)
      `
      )
      .run({
        id: input.session.id,
        user_id: input.session.userId,
        device_id: input.session.deviceId,
        refresh_token_hash: input.session.refreshTokenHash,
        user_agent: input.session.userAgent ?? null,
        ip_address: input.session.ipAddress ?? null,
        metadata: serializeJsonColumn(input.session.metadata),
        created_at: input.session.createdAt,
        expires_at: input.session.expiresAt,
        revoked_at: input.session.revokedAt ?? null
      });

    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ? LIMIT 1").get(input.session.id) as SessionRow | undefined;
    if (!row) {
      throw new Error("Failed to load session after insert");
    }
    return toSessionRecord(row);
  }

  async updateSessionRefresh(input: UpdateSessionRefreshInput): Promise<void> {
    this.db
      .prepare(
        `
        UPDATE sessions
        SET refresh_token_hash = @refresh_token_hash,
            expires_at = @expires_at,
            metadata = COALESCE(@metadata, metadata)
        WHERE id = @id
      `
      )
      .run({
        id: input.sessionId,
        refresh_token_hash: input.refreshTokenHash,
        expires_at: input.expiresAt,
        metadata: serializeJsonColumn(input.metadata ?? null)
      });
  }

  async getSessionById(sessionId: string): Promise<SessionRecord | null> {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ? LIMIT 1").get(sessionId) as SessionRow | undefined;
    return row ? toSessionRecord(row) : null;
  }

  async getSessionByRefreshHash(hash: string): Promise<SessionRecord | null> {
    const row = this.db
      .prepare(
        `
        SELECT * FROM sessions
        WHERE refresh_token_hash = ? AND revoked_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC
        LIMIT 1
      `
      )
      .get(hash, Date.now()) as SessionRow | undefined;
    return row ? toSessionRecord(row) : null;
  }

  async revokeSession(sessionId: string, revokedAt: number): Promise<void> {
    this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").run(revokedAt, sessionId);
  }

  async revokeSessionsByUser(userId: string, revokedAt: number): Promise<void> {
    this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ?").run(revokedAt, userId);
  }

  async listActiveSessions(userId: string): Promise<ReadonlyArray<SessionRecord>> {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM sessions
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC
      `
      )
      .all(userId, Date.now()) as SessionRow[];
    return rows.map(toSessionRecord);
  }

  async createPasswordReset(input: CreatePasswordResetInput): Promise<PasswordResetRecord> {
    this.db
      .prepare(
        `
        INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at, used_at, ip_address, user_agent)
        VALUES (@id, @user_id, @token_hash, @created_at, @expires_at, @used_at, @ip_address, @user_agent)
      `
      )
      .run({
        id: input.reset.id,
        user_id: input.reset.userId,
        token_hash: input.reset.tokenHash,
        created_at: input.reset.createdAt,
        expires_at: input.reset.expiresAt,
        used_at: input.reset.usedAt ?? null,
        ip_address: input.reset.ipAddress ?? null,
        user_agent: input.reset.userAgent ?? null
      });

    const row = this.db.prepare("SELECT * FROM password_resets WHERE id = ? LIMIT 1").get(input.reset.id) as PasswordResetRow | undefined;
    if (!row) {
      throw new Error("Failed to load password reset after insert");
    }
    return toPasswordResetRecord(row);
  }

  async getPasswordResetByTokenHash(hash: string): Promise<PasswordResetRecord | null> {
    const row = this.db
      .prepare(
        `
        SELECT * FROM password_resets
        WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC LIMIT 1
      `
      )
      .get(hash, Date.now()) as PasswordResetRow | undefined;
    return row ? toPasswordResetRecord(row) : null;
  }

  async markPasswordResetUsed(resetId: string, usedAt: number): Promise<void> {
    this.db.prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").run(usedAt, resetId);
  }

  async createAuditLog(input: CreateAuditLogInput): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO audit_logs (id, user_id, event_type, metadata, ip_address, user_agent, created_at)
        VALUES (@id, @user_id, @event_type, @metadata, @ip_address, @user_agent, @created_at)
      `
      )
      .run({
        id: input.entry.id,
        user_id: input.entry.userId ?? null,
        event_type: input.entry.eventType,
        metadata: serializeJsonColumn(input.entry.metadata),
        ip_address: input.entry.ipAddress ?? null,
        user_agent: input.entry.userAgent ?? null,
        created_at: input.entry.createdAt
      });
  }

  async getOAuthLinkBySubject(provider: string, subject: string): Promise<OAuthProviderLink | null> {
    const row = this.db
      .prepare(
        `
        SELECT * FROM oauth_providers
        WHERE provider = ? AND subject = ? AND revoked_at IS NULL
        LIMIT 1
      `
      )
      .get(provider, subject) as OAuthProviderRow | undefined;
    return row ? toOAuthLinkRecord(row) : null;
  }

  async getOAuthLinkByUser(provider: string, userId: string): Promise<OAuthProviderLink | null> {
    const row = this.db
      .prepare(
        `
        SELECT * FROM oauth_providers
        WHERE provider = ? AND user_id = ? AND revoked_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      `
      )
      .get(provider, userId) as OAuthProviderRow | undefined;
    return row ? toOAuthLinkRecord(row) : null;
  }

  async upsertOAuthLink(input: OAuthLinkUpsert): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO oauth_providers (id, user_id, provider, subject, email, email_verified, access_token, refresh_token, scopes, metadata, created_at, updated_at, revoked_at)
        VALUES (@id, @user_id, @provider, @subject, @email, @email_verified, @access_token, @refresh_token, @scopes, @metadata, @created_at, @updated_at, @revoked_at)
        ON CONFLICT(id) DO UPDATE SET
          email = excluded.email,
          email_verified = excluded.email_verified,
          access_token = excluded.access_token,
          refresh_token = excluded.refresh_token,
          scopes = excluded.scopes,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at,
          revoked_at = excluded.revoked_at
      `
      )
      .run({
        id: input.link.id,
        user_id: input.link.userId,
        provider: input.link.provider,
        subject: input.link.subject,
        email: input.link.email,
        email_verified: input.link.emailVerified ? 1 : 0,
        access_token: input.link.accessToken ?? null,
        refresh_token: input.link.refreshToken ?? null,
        scopes: serializeJsonColumn(input.link.scopes),
        metadata: serializeJsonColumn(input.link.metadata),
        created_at: input.link.createdAt,
        updated_at: input.link.updatedAt,
        revoked_at: input.link.revokedAt ?? null
      });
  }

  async getMfaMethodsByUser(userId: string): Promise<ReadonlyArray<MfaMethodRecord>> {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM mfa_methods
        WHERE user_id = ? AND disabled_at IS NULL
        ORDER BY created_at ASC
      `
      )
      .all(userId) as MfaMethodRow[];
    return rows.map(toMfaMethodRecord);
  }

  async createOrUpdateMfaMethod(method: MfaMethodRecord): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO mfa_methods (id, user_id, type, secret, label, metadata, created_at, updated_at, verified_at, disabled_at)
        VALUES (@id, @user_id, @type, @secret, @label, @metadata, @created_at, @updated_at, @verified_at, @disabled_at)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          secret = excluded.secret,
          label = excluded.label,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at,
          verified_at = excluded.verified_at,
          disabled_at = excluded.disabled_at
      `
      )
      .run({
        id: method.id,
        user_id: method.userId,
        type: method.type,
        secret: method.secret ?? null,
        label: method.label ?? null,
        metadata: serializeJsonColumn(method.metadata),
        created_at: method.createdAt,
        updated_at: method.updatedAt,
        verified_at: method.verifiedAt ?? null,
        disabled_at: method.disabledAt ?? null
      });
  }

  async removeMfaMethod(methodId: string): Promise<void> {
    this.db.prepare("UPDATE mfa_methods SET disabled_at = ? WHERE id = ?").run(Date.now(), methodId);
  }

  async createOrUpdateUserProfile(user: UserProfile): Promise<UserProfile> {
    this.db
      .prepare(
        `
        INSERT INTO users (id, email, email_verified, display_name, created_at, updated_at, deleted_at, locale)
        VALUES (@id, @email, @email_verified, @display_name, @created_at, @updated_at, @deleted_at, @locale)
        ON CONFLICT(id) DO UPDATE SET
          email = excluded.email,
          email_verified = excluded.email_verified,
          display_name = excluded.display_name,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at,
          locale = excluded.locale
      `
      )
      .run({
        id: user.id,
        email: user.email,
        email_verified: user.emailVerified ? 1 : 0,
        display_name: user.displayName,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
        deleted_at: user.deletedAt ?? null,
        locale: user.locale ?? null
      });
    const row = this.db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(user.id) as UserRow | undefined;
    if (!row) {
      throw new Error("Failed to load user profile after upsert");
    }
    return toUserProfile(row);
  }

}

export type { IdentityStore };
