import type { OAuthProviderLink, UserProfile } from "@thortiq/client-core";
import { ulid } from "ulidx";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyResult } from "jose";

import type { IdentityStore } from "../identity/types";
import type { SessionManager } from "./sessionService";
import type { DeviceService } from "./deviceService";
import type { Logger } from "../logger";
import type { GoogleOAuthConfig } from "../config";

export interface GoogleSignInRequest {
  readonly idToken: string;
  readonly deviceId?: string;
  readonly deviceDisplayName: string;
  readonly platform: string;
  readonly rememberDevice: boolean;
  readonly userAgent?: string;
  readonly ipAddress?: string;
}

export interface GoogleSignInResult {
  readonly user: UserProfile;
  readonly tokens: {
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly expiresAt: number;
    readonly issuedAt: number;
  };
  readonly refreshToken: string;
  readonly refreshExpiresAt: number;
}

export interface GoogleAuthServiceOptions {
  readonly identityStore: IdentityStore;
  readonly sessionManager: SessionManager;
  readonly deviceService: DeviceService;
  readonly config: GoogleOAuthConfig;
  readonly logger: Logger;
}

interface ParsedGoogleProfile {
  readonly email: string;
  readonly emailVerified: boolean;
  readonly subject: string;
  readonly name?: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly picture?: string;
  readonly hostDomain?: string;
  readonly issuer?: string;
}

export class GoogleAuthService {
  private readonly store: IdentityStore;
  private readonly sessions: SessionManager;
  private readonly devices: DeviceService;
  private readonly config: GoogleOAuthConfig;
  private readonly logger: Logger;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(options: GoogleAuthServiceOptions) {
    this.store = options.identityStore;
    this.sessions = options.sessionManager;
    this.devices = options.deviceService;
    this.config = options.config;
    this.logger = options.logger;
    this.jwks = createRemoteJWKSet(new URL(this.config.jwksUri));
  }

  async signIn(request: GoogleSignInRequest): Promise<GoogleSignInResult> {
    const verification = await this.verifyIdToken(request.idToken);
    const profile = this.parsePayload(verification.payload);

    const link = await this.store.getOAuthLinkBySubject("google", profile.subject);
    let user: UserProfile | null = null;
    let providerLink: OAuthProviderLink | null = null;

    if (link) {
      user = await this.store.getUserById(link.userId);
      providerLink = link;
    }

    if (!user) {
      user = await this.findOrCreateUser(profile);
    }

    providerLink = await this.persistProviderLink(user, profile, providerLink);

    const device = await this.devices.upsert({
      user,
      deviceId: request.deviceId,
      displayName: request.deviceDisplayName,
      platform: request.platform,
      trusted: request.rememberDevice,
      rememberDevice: request.rememberDevice,
      metadata: {
        loginMethod: "google",
        subject: profile.subject
      }
    });

    const session = await this.sessions.createSession({
      user,
      device,
      credential: null,
      trustedDevice: request.rememberDevice,
      userAgent: request.userAgent,
      ipAddress: request.ipAddress,
      metadata: {
        loginMethod: "google",
        googleSubject: profile.subject
      }
    });

    this.logger.info("Google sign-in success", { userId: user.id, providerLinkId: providerLink.id });

    return {
      user,
      tokens: session.tokens.pair,
      refreshToken: session.tokens.refreshToken,
      refreshExpiresAt: session.tokens.refreshExpiresAt
    };
  }

  private async verifyIdToken(idToken: string): Promise<JWTVerifyResult> {
    return jwtVerify(idToken, this.jwks, {
      audience: this.config.audience,
      issuer: this.config.issuer,
      clockTolerance: this.config.clockToleranceSeconds
    });
  }

  private async findOrCreateUser(profile: ParsedGoogleProfile): Promise<UserProfile> {
    const existing = await this.store.getUserByEmail(profile.email);
    if (existing) {
      return existing;
    }

    const now = Date.now();
    const user: UserProfile = {
      id: ulid(),
      email: profile.email,
      emailVerified: profile.emailVerified,
      displayName: this.resolveDisplayName(profile),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      locale: null
    };

    const link: OAuthProviderLink = {
      id: ulid(),
      userId: user.id,
      provider: "google",
      subject: profile.subject,
      email: profile.email,
      emailVerified: profile.emailVerified,
      accessToken: null,
      refreshToken: null,
      scopes: null,
      metadata: this.createLinkMetadata(profile),
      createdAt: now,
      updatedAt: now,
      revokedAt: null
    };

    await this.store.createUser({ user, credential: null, googleLink: link });
    return user;
  }

  private async persistProviderLink(
    user: UserProfile,
    profile: ParsedGoogleProfile,
    current: OAuthProviderLink | null
  ): Promise<OAuthProviderLink> {
    const now = Date.now();
    const link: OAuthProviderLink = current
      ? {
          ...current,
          email: profile.email,
          emailVerified: profile.emailVerified,
          metadata: this.createLinkMetadata(profile),
          updatedAt: now
        }
      : {
          id: ulid(),
          userId: user.id,
          provider: "google",
          subject: profile.subject,
          email: profile.email,
          emailVerified: profile.emailVerified,
          accessToken: null,
          refreshToken: null,
          scopes: null,
          metadata: this.createLinkMetadata(profile),
          createdAt: now,
          updatedAt: now,
          revokedAt: null
        };

    await this.store.upsertOAuthLink({ link });
    return link;
  }

  private resolveDisplayName(profile: ParsedGoogleProfile): string {
    if (profile.name) {
      return profile.name;
    }
    if (profile.givenName && profile.familyName) {
      return `${profile.givenName} ${profile.familyName}`;
    }
    if (profile.email) {
      return profile.email.split("@")[0];
    }
    return "Google User";
  }

  private createLinkMetadata(profile: ParsedGoogleProfile): Readonly<Record<string, unknown>> | null {
    const metadata: Record<string, unknown> = {};
    if (profile.picture) {
      metadata.picture = profile.picture;
    }
    if (profile.hostDomain) {
      metadata.hostDomain = profile.hostDomain;
    }
    if (profile.issuer) {
      metadata.issuer = profile.issuer;
    }
    return Object.keys(metadata).length > 0 ? metadata : null;
  }

  private parsePayload(payload: JWTVerifyResult["payload"]): ParsedGoogleProfile {
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!email) {
      throw new Error("Google token did not include email");
    }

    const subject = typeof payload.sub === "string" ? payload.sub : "";
    const name = typeof payload.name === "string" ? payload.name : undefined;
    const givenName = typeof payload.given_name === "string" ? payload.given_name : undefined;
    const familyName = typeof payload.family_name === "string" ? payload.family_name : undefined;
    const picture = typeof payload.picture === "string" ? payload.picture : undefined;
    const hostDomain = typeof payload.hd === "string" ? payload.hd : undefined;
    const issuer = typeof payload.iss === "string" ? payload.iss : undefined;

    return {
      email,
      emailVerified: typeof payload.email_verified === "boolean" ? payload.email_verified : false,
      subject,
      name,
      givenName,
      familyName,
      picture,
      hostDomain,
      issuer
    };
  }
}
