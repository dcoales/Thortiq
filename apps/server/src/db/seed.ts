import type {
  CredentialRecord,
  CredentialType,
  Timestamp,
  UserId,
  UserProfile
} from "@thortiq/client-core";

export interface SeedStatement {
  readonly table: string;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface SeedUserOptions {
  readonly userId: UserId;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly credentialType?: CredentialType;
  readonly createdAt?: Timestamp;
}

const toUnixMs = (value: Timestamp | undefined): Timestamp => value ?? Date.now();

export const createSeedUser = (options: SeedUserOptions): Readonly<{
  user: UserProfile;
  credential: CredentialRecord;
}> => {
  const createdAt = toUnixMs(options.createdAt);
  const user: UserProfile = {
    id: options.userId,
    email: options.email,
    emailVerified: false,
    displayName: options.displayName,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    locale: null
  };

  const credential: CredentialRecord = {
    id: `${options.userId}-credential`,
    userId: options.userId,
    type: options.credentialType ?? "password",
    hash: options.passwordHash,
    salt: null,
    metadata: null,
    createdAt,
    updatedAt: createdAt,
    revokedAt: null
  };

  return { user, credential };
};

export const createSeedStatements = (seed: ReadonlyArray<SeedStatement>): ReadonlyArray<SeedStatement> => seed;
