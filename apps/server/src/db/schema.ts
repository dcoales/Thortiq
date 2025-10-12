import type {
  CredentialType,
  MfaMethodType,
  OAuthProvider
} from "@thortiq/client-core";

export interface Migration {
  readonly id: string;
  readonly statements: ReadonlyArray<string>;
}

const USERS_TABLE = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  locale TEXT
);
`.trim();

const CREDENTIALS_TABLE = `
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  hash TEXT NOT NULL,
  salt TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`.trim();

const CREDENTIALS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_credentials_user_type ON credentials (user_id, type);
`.trim();

const OAUTH_LINKS_TABLE = `
CREATE TABLE IF NOT EXISTS oauth_providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  access_token TEXT,
  refresh_token TEXT,
  scopes TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(provider, subject)
);
`.trim();

const DEVICES_TABLE = `
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  trusted INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`.trim();

const SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);
`.trim();

const MFA_METHODS_TABLE = `
CREATE TABLE IF NOT EXISTS mfa_methods (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  secret TEXT,
  label TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  verified_at INTEGER,
  disabled_at INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`.trim();

const USER_PREFERENCES_TABLE = `
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, key),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`.trim();

const PASSWORD_RESETS_TABLE = `
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  ip_address TEXT,
  user_agent TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`.trim();

const AUDIT_LOGS_TABLE = `
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  event_type TEXT NOT NULL,
  metadata TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);
`.trim();

const REGISTRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  consents TEXT,
  remember_device INTEGER NOT NULL DEFAULT 0,
  device_display_name TEXT,
  device_platform TEXT,
  device_id TEXT,
  locale TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_sent_at INTEGER NOT NULL,
  resend_available_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  completed_at INTEGER
);
`.trim();

const REGISTRATIONS_TOKEN_INDEX = `
CREATE INDEX IF NOT EXISTS idx_registrations_token_hash ON registrations (token_hash);
`.trim();

export const INITIAL_MIGRATION: Migration = {
  id: "0001_initial_identity_schema",
  statements: [
    USERS_TABLE,
    CREDENTIALS_TABLE,
    CREDENTIALS_INDEX,
    OAUTH_LINKS_TABLE,
    DEVICES_TABLE,
    SESSIONS_TABLE,
    MFA_METHODS_TABLE,
    USER_PREFERENCES_TABLE,
    PASSWORD_RESETS_TABLE,
    AUDIT_LOGS_TABLE,
    REGISTRATIONS_TABLE,
    REGISTRATIONS_TOKEN_INDEX
  ]
};

export interface SqlExecutor {
  exec(sql: string): Promise<void> | void;
}

export const applyMigration = async (migration: Migration, executor: SqlExecutor): Promise<void> => {
  for (const statement of migration.statements) {
    await executor.exec(statement);
  }
};

export type SupportedCredentialType = CredentialType;
export type SupportedOAuthProvider = OAuthProvider;
export type SupportedMfaMethodType = MfaMethodType;
