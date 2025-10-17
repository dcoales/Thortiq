import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config";
import { SqliteIdentityStore } from "../identity/sqliteStore";
import { Argon2PasswordHasher } from "../security/passwordHasher";
import { SlidingWindowRateLimiter } from "../security/rateLimiter";
import { PasswordResetService } from "./passwordResetService";
import { createConsoleLogger } from "../logger";
import { TokenService } from "../security/tokenService";
import { SessionManager } from "./sessionService";
import { DeviceService } from "./deviceService";
import { MfaService } from "./mfaService";
import { AuthService } from "./authService";
import type { CredentialRecord, UserProfile } from "@thortiq/client-core";
import { SecretVault } from "../security/secretVault";
import { LoggingSecurityAlertChannel, SecurityAlertService } from "./securityAlertService";

const testConfig = loadConfig({
  AUTH_JWT_ACCESS_SECRET: "reset-access-secret",
  AUTH_JWT_REFRESH_SECRET: "reset-refresh-secret",
  AUTH_PASSWORD_PEPPER: "reset-pepper",
  AUTH_DATABASE_PATH: ":memory:",
  AUTH_JWT_ISSUER: "https://reset.local",
  AUTH_JWT_AUDIENCE: "reset-clients",
  SYNC_SHARED_SECRET: "shared-secret"
});

describe("PasswordResetService", () => {
  let store: SqliteIdentityStore;
  let passwordHasher: Argon2PasswordHasher;
  let resetService: PasswordResetService;
  let authService: AuthService;
  let tokenService: TokenService;
  let user: UserProfile;

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
    const sessionManager = new SessionManager({
      identityStore: store,
      tokenService,
      trustedDeviceLifetimeSeconds: testConfig.trustedDeviceLifetimeSeconds
    });
    const deviceService = new DeviceService(store);
    const secretVault = new SecretVault({ secretKey: testConfig.mfa.secretKey });
    const securityAlerts = new SecurityAlertService({ enabled: true, logger });
    securityAlerts.registerChannel(new LoggingSecurityAlertChannel(logger));
    const mfaService = new MfaService({
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

    const passwordHash = await passwordHasher.hash("OriginalPass123!");
    const now = Date.now();
    user = {
      id: "user-reset",
      email: "reset@thortiq.test",
      emailVerified: true,
      displayName: "Reset Candidate",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      locale: null
    };
    const credential: CredentialRecord = {
      id: "cred-reset",
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

    resetService = new PasswordResetService({
      identityStore: store,
      passwordHasher,
      logger,
      tokenLifetimeSeconds: testConfig.forgotPassword.tokenLifetimeSeconds,
      rateLimiterPerIdentifier: new SlidingWindowRateLimiter({
        windowSeconds: testConfig.forgotPassword.windowSeconds,
        maxAttempts: testConfig.forgotPassword.maxRequestsPerWindow
      }),
      rateLimiterPerIp: new SlidingWindowRateLimiter({
        windowSeconds: testConfig.forgotPassword.windowSeconds,
        maxAttempts: testConfig.forgotPassword.maxRequestsPerWindow
      }),
      notifier: {
        sendResetNotification: vi.fn().mockResolvedValue(undefined)
      }
    });
  });

  afterEach(() => {
    store.close();
  });

  it("resets password and revokes prior sessions", async () => {
    const login = await authService.login({
      identifier: user.email,
      password: "OriginalPass123!",
      deviceDisplayName: "Browser",
      platform: "web",
      rememberDevice: false
    });
    expect(login.status).toBe("success");

    const request = await resetService.requestReset({ identifier: user.email });
    expect(request.accepted).toBe(true);
    expect(request.token).toBeTruthy();

    const resetResult = await resetService.resetPassword({
      token: request.token as string,
      newPassword: "ChangedPass456!"
    });
    expect(resetResult.success).toBe(true);

    const refreshedCredential = await store.getCredentialByUser(user.id, "password");
    expect(refreshedCredential).toBeTruthy();
    const valid = await passwordHasher.verify("ChangedPass456!", refreshedCredential!.hash);
    expect(valid).toBe(true);

    const sessions = await store.listActiveSessions(user.id);
    expect(sessions.length).toBe(0);

    const reLogin = await authService.login({
      identifier: user.email,
      password: "ChangedPass456!",
      deviceDisplayName: "Browser",
      platform: "web",
      rememberDevice: false
    });
    expect(reLogin.status).toBe("success");
  });
});
