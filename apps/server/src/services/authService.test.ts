import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { loadConfig } from "../config";
import { SqliteIdentityStore } from "../identity/sqliteStore";
import { Argon2PasswordHasher } from "../security/passwordHasher";
import { TokenService } from "../security/tokenService";
import { createConsoleLogger } from "../logger";
import { SessionManager } from "./sessionService";
import { DeviceService } from "./deviceService";
import { AuthService } from "./authService";
import { MfaService } from "./mfaService";
import type { UserProfile, CredentialRecord } from "@thortiq/client-core";
import { authenticator } from "otplib";
import { SecretVault } from "../security/secretVault";
import { LoggingSecurityAlertChannel, SecurityAlertService } from "./securityAlertService";

const testConfig = loadConfig({
  AUTH_JWT_ACCESS_SECRET: "test-access-secret",
  AUTH_JWT_REFRESH_SECRET: "test-refresh-secret",
  AUTH_PASSWORD_PEPPER: "test-pepper",
  AUTH_DATABASE_PATH: ":memory:",
  AUTH_JWT_ISSUER: "https://test.local",
  AUTH_JWT_AUDIENCE: "test-clients",
  SYNC_SHARED_SECRET: "shared-secret",
  AUTH_ACCESS_TOKEN_SECONDS: "900",
  AUTH_REFRESH_TOKEN_TRUSTED_SECONDS: "86400",
  AUTH_REFRESH_TOKEN_UNTRUSTED_SECONDS: "43200"
});

describe("AuthService", () => {
  let store: SqliteIdentityStore;
  let passwordHasher: Argon2PasswordHasher;
  let tokenService: TokenService;
  let sessionManager: SessionManager;
  let deviceService: DeviceService;
  let mfaService: MfaService;
  let authService: AuthService;
  let user: UserProfile;
  let credential: CredentialRecord;

  beforeEach(async () => {
    store = new SqliteIdentityStore({ path: ":memory:" });
    const logger = createConsoleLogger();
    passwordHasher = new Argon2PasswordHasher({
      memoryCost: testConfig.passwordPolicy.argonMemoryCost,
      timeCost: testConfig.passwordPolicy.argonTimeCost,
      parallelism: testConfig.passwordPolicy.argonParallelism,
      pepper: testConfig.passwordPolicy.pepper
    });
    tokenService = new TokenService({
      authEnvironment: testConfig.authEnvironment,
      accessTokenSecret: testConfig.jwt.accessTokenSecret,
      refreshTokenPolicy: testConfig.refreshTokenPolicy
    });
    sessionManager = new SessionManager({
      identityStore: store,
      tokenService,
      trustedDeviceLifetimeSeconds: testConfig.trustedDeviceLifetimeSeconds
    });
    deviceService = new DeviceService(store);
    const secretVault = new SecretVault({ secretKey: testConfig.mfa.secretKey });
    const securityAlerts = new SecurityAlertService({ enabled: true, logger });
    securityAlerts.registerChannel(new LoggingSecurityAlertChannel(logger));
    mfaService = new MfaService({
      identityStore: store,
      logger,
      window: 1,
      vault: secretVault,
      totpIssuer: testConfig.mfa.totpIssuer,
      enrollmentWindowSeconds: testConfig.mfa.enrollmentWindowSeconds
    });
    authService = new AuthService({
      identityStore: store,
      passwordHasher,
      tokenService,
      mfaService,
      logger,
      sessionManager,
      deviceService,
      securityAlerts
    });

    const passwordHash = await passwordHasher.hash("ThortiqPass123!");
    const now = Date.now();
    user = {
      id: "user-123",
      email: "multi@thortiq.test",
      emailVerified: true,
      displayName: "Test User",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      locale: null
    };
    credential = {
      id: "cred-123",
      userId: user.id,
      type: "password",
      hash: passwordHash,
      salt: null,
      metadata: null,
      createdAt: now,
      updatedAt: now,
      revokedAt: null
    };

    await store.createUser({ user, credential, googleLink: null });
  });

  afterEach(() => {
    store.close();
  });

  it("logs in with correct credentials and issues tokens", async () => {
    const result = await authService.login({
      identifier: user.email,
      password: "ThortiqPass123!",
      deviceDisplayName: "MacBook Pro",
      platform: "macos",
      rememberDevice: true,
      userAgent: "Vitest",
      ipAddress: "127.0.0.1"
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      return;
    }

    expect(result.tokens.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.refreshExpiresAt).toBeGreaterThan(result.tokens.expiresAt);
    const claims = tokenService.verifyAccessToken(result.tokens.accessToken);
    expect(claims?.sub).toBe(user.id);
    expect(claims?.sessionId).toBe(result.session.id);
  });

  it("requires MFA when methods exist and accepts codes", async () => {
    const { challenge } = await mfaService.createTotpEnrollment(user.id, "Test Device");
    const firstAttempt = await authService.login({
      identifier: user.email,
      password: "ThortiqPass123!",
      deviceDisplayName: "MacBook Pro",
      platform: "macos",
      rememberDevice: false,
      userAgent: "Vitest",
      ipAddress: "127.0.0.1"
    });

    expect(firstAttempt.status).toBe("mfa_required");

    const code = authenticator.generate(challenge.secretBase32);
    const secondAttempt = await authService.login({
      identifier: user.email,
      password: "ThortiqPass123!",
      deviceDisplayName: "MacBook Pro",
      platform: "macos",
      rememberDevice: false,
      userAgent: "Vitest",
      ipAddress: "127.0.0.1",
      mfaCode: code
    });

    expect(secondAttempt.status).toBe("success");
  });

  it("rotates refresh tokens", async () => {
    const login = await authService.login({
      identifier: user.email,
      password: "ThortiqPass123!",
      deviceDisplayName: "MacBook Pro",
      platform: "macos",
      rememberDevice: true,
      userAgent: "Vitest",
      ipAddress: "127.0.0.1"
    });

    expect(login.status).toBe("success");
    if (login.status !== "success") {
      return;
    }

    const refresh = await authService.refresh({
      refreshToken: login.refreshToken,
      userAgent: "Vitest",
      ipAddress: "127.0.0.1",
      rememberDevice: true
    });

    expect(refresh.status).toBe("success");
    if (refresh.status !== "success") {
      return;
    }
    expect(refresh.refreshToken).toBeTruthy();
    expect(refresh.refreshToken).not.toBe(login.refreshToken);
    expect(refresh.refreshExpiresAt).toBeDefined();
  });
});
