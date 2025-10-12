import { createHash, randomBytes } from "node:crypto";

import jwt from "jsonwebtoken";

import type { AuthEnvironmentConfig, TokenClaims, TokenPair } from "@thortiq/client-core";

export interface TokenServiceOptions {
  readonly authEnvironment: AuthEnvironmentConfig;
  readonly accessTokenSecret: string;
  readonly refreshTokenPolicy: {
    readonly trustedSeconds: number;
    readonly untrustedSeconds: number;
  };
}

export interface AccessTokenInput {
  readonly userId: string;
  readonly sessionId: string;
  readonly deviceId: string;
  readonly scope?: string;
  readonly mfa?: boolean;
}

export interface RefreshTokenIssueInput {
  readonly trusted: boolean;
}

export interface TokenRotationResult {
  readonly pair: TokenPair;
  readonly refreshToken: string;
  readonly refreshTokenHash: string;
  readonly accessClaims: TokenClaims;
  readonly refreshExpiresAt: number;
}

export class TokenService {
  private readonly options: TokenServiceOptions;

  constructor(options: TokenServiceOptions) {
    this.options = options;
  }

  createAccessToken(input: AccessTokenInput): { token: string; claims: TokenClaims } {
    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = issuedAtSeconds + this.options.authEnvironment.accessTokenLifetimeSeconds;

    const payload: TokenClaims = {
      sub: input.userId,
      sessionId: input.sessionId,
      deviceId: input.deviceId,
      scope: input.scope,
      mfa: input.mfa,
      exp: expiresAtSeconds,
      iat: issuedAtSeconds
    };

    const token = jwt.sign(payload, this.options.accessTokenSecret, {
      algorithm: "HS256",
      issuer: this.options.authEnvironment.jwtIssuer,
      audience: this.options.authEnvironment.jwtAudience
    });

    return { token, claims: payload };
  }

  verifyAccessToken(token: string): TokenClaims | null {
    try {
      const decoded = jwt.verify(token, this.options.accessTokenSecret, {
        algorithms: ["HS256"],
        issuer: this.options.authEnvironment.jwtIssuer,
        audience: this.options.authEnvironment.jwtAudience
      }) as TokenClaims;
      return decoded;
    } catch (_error) {
      return null;
    }
  }

  createRefreshToken(input: RefreshTokenIssueInput): { token: string; hash: string; expiresAt: number } {
    const token = randomBytes(64).toString("base64url");
    const expiresAt =
      Date.now() + (input.trusted ? this.options.refreshTokenPolicy.trustedSeconds : this.options.refreshTokenPolicy.untrustedSeconds) * 1000;
    return { token, hash: this.hash(token), expiresAt };
  }

  rotateTokens(accessInput: AccessTokenInput, refreshInput: RefreshTokenIssueInput): TokenRotationResult {
    const { token: accessToken, claims } = this.createAccessToken(accessInput);
    const { token: refreshToken, hash, expiresAt } = this.createRefreshToken(refreshInput);
    return {
      pair: {
        accessToken,
        refreshToken,
        issuedAt: claims.iat * 1000,
        expiresAt: claims.exp * 1000
      },
      refreshToken: refreshToken,
      refreshTokenHash: hash,
      accessClaims: claims,
      refreshExpiresAt: expiresAt
    };
  }

  hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  // Refresh tokens are random strings; we expose hashing so callers can safely persist metadata.
}
