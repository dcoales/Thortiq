import http from "node:http";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../config";
import { createAuthRouter } from "./authRoutes";
import { SqliteIdentityStore } from "../identity/sqliteStore";
import { Argon2PasswordHasher } from "../security/passwordHasher";
import { TokenService } from "../security/tokenService";
import { createConsoleLogger } from "../logger";
import { SessionManager } from "../services/sessionService";
import { DeviceService } from "../services/deviceService";
import { MfaService } from "../services/mfaService";
import { AuthService } from "../services/authService";
import { PasswordResetService } from "../services/passwordResetService";
import { SlidingWindowRateLimiter } from "../security/rateLimiter";
import { RegistrationService } from "../services/registrationService";
import type { UserProfile, CredentialRecord } from "@thortiq/client-core";
import { SecretVault } from "../security/secretVault";
import { LoggingSecurityAlertChannel, SecurityAlertService } from "../services/securityAlertService";

const testConfig = loadConfig({
  AUTH_JWT_ACCESS_SECRET: "router-access",
  AUTH_JWT_REFRESH_SECRET: "router-refresh",
  AUTH_PASSWORD_PEPPER: "router-pepper",
  AUTH_DATABASE_PATH: ":memory:",
  AUTH_JWT_ISSUER: "https://router.local",
  AUTH_JWT_AUDIENCE: "router-clients",
  SYNC_SHARED_SECRET: "shared-secret",
  PORT: "0",
  AUTH_REGISTRATION_DEV_MAILBOX: "./coverage/test-mailbox"
});

describe("auth routes", () => {
  let server: http.Server;
  let store: SqliteIdentityStore;
  let address: { port: number };

  beforeEach(async () => {
    if (testConfig.registration.devMailboxPath) {
      await rm(testConfig.registration.devMailboxPath, { recursive: true, force: true });
    }
    store = new SqliteIdentityStore({ path: ":memory:" });
    const logger = createConsoleLogger();
    const passwordHasher = new Argon2PasswordHasher({
      memoryCost: testConfig.passwordPolicy.argonMemoryCost,
      timeCost: testConfig.passwordPolicy.argonTimeCost,
      parallelism: testConfig.passwordPolicy.argonParallelism,
      pepper: testConfig.passwordPolicy.pepper
    });
    const tokenService = new TokenService({
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
    const authService = new AuthService({
      identityStore: store,
      passwordHasher,
      tokenService,
      mfaService,
      logger,
      sessionManager,
      deviceService,
      securityAlerts
    });
    const passwordResetService = new PasswordResetService({
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
      })
    });

    const registrationService = new RegistrationService({
      identityStore: store,
      passwordHasher,
      sessionManager,
      deviceService,
      logger,
      securityAlerts,
      rateLimiterPerIdentifier: new SlidingWindowRateLimiter({
        windowSeconds: testConfig.registration.windowSeconds,
        maxAttempts: testConfig.registration.maxRequestsPerWindow
      }),
      rateLimiterPerIp: new SlidingWindowRateLimiter({
        windowSeconds: testConfig.registration.windowSeconds,
        maxAttempts: testConfig.registration.maxRequestsPerWindow
      }),
      config: testConfig.registration
    });

    const router = createAuthRouter({
      config: testConfig,
      authService,
      passwordResetService,
      registrationService,
      googleAuthService: null,
      mfaService,
      tokenService,
      logger,
      securityAlerts
    });

    server = http.createServer(async (req, res) => {
      if (await router(req, res)) {
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
    const info = server.address();
    if (typeof info === "object" && info) {
      address = { port: info.port };
    } else {
      throw new Error("Failed to obtain server address");
    }

    const passwordHash = await passwordHasher.hash("RouterPass123!");
    const now = Date.now();
    const user: UserProfile = {
      id: "router-user",
      email: "router@test.local",
      emailVerified: true,
      displayName: "Router User",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      locale: null
    };
    const credential: CredentialRecord = {
      id: "router-cred",
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

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    store.close();
    if (testConfig.registration.devMailboxPath) {
      await rm(testConfig.registration.devMailboxPath, { recursive: true, force: true });
    }
  });

  it("handles login and sets refresh cookie", async () => {
    const response = await fetch(`http://127.0.0.1:${address.port}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        identifier: "router@test.local",
        password: "RouterPass123!",
        deviceDisplayName: "Browser",
        platform: "web",
        remember: true
      })
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.accessToken).toBeTypeOf("string");
    expect(payload.refreshExpiresAt).toBeTypeOf("number");
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith(`${testConfig.refreshTokenCookieName}=`))).toBe(true);
  });

  it("responds to CORS preflight for auth endpoints", async () => {
    const response = await fetch(`http://127.0.0.1:${address.port}/auth/register`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type"
      }
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });

  const readRegistrationToken = async (): Promise<string> => {
    const mailbox = testConfig.registration.devMailboxPath;
    if (!mailbox) {
      throw new Error("Dev mailbox path not configured");
    }
    const files = await readdir(mailbox);
    expect(files.length).toBeGreaterThan(0);
    const latest = files.sort().at(-1);
    if (!latest) {
      throw new Error("No verification file found");
    }
    const contents = await readFile(join(mailbox, latest), "utf8");
    const match = contents.match(/token=([^\s]+)/);
    if (!match) {
      throw new Error("Token not found in verification email");
    }
    return decodeURIComponent(match[1]);
  };

  it("accepts registration requests and records pending token", async () => {
    const response = await fetch(`http://127.0.0.1:${address.port}/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        identifier: "new-user@test.local",
        password: "ThortiqPass123!",
        deviceDisplayName: "Browser",
        platform: "web",
        remember: true,
        consents: {
          termsAccepted: true,
          privacyAccepted: true
        }
      })
    });

    expect(response.status).toBe(202);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.status).toBe("pending");
    const pending = await store.getRegistrationByIdentifier("new-user@test.local");
    expect(pending).not.toBeNull();
  });

  it("verifies registration tokens and returns session", async () => {
    const registerResponse = await fetch(`http://127.0.0.1:${address.port}/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        identifier: "activate@test.local",
        password: "ThortiqPass123!",
        deviceDisplayName: "Browser",
        platform: "web",
        remember: true,
        consents: {
          termsAccepted: true,
          privacyAccepted: true
        }
      })
    });
    expect(registerResponse.status).toBe(202);

    const token = await readRegistrationToken();

    const verifyResponse = await fetch(`http://127.0.0.1:${address.port}/auth/register/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        token,
        deviceDisplayName: "Browser",
        platform: "web",
        remember: true
      })
    });

    expect(verifyResponse.status).toBe(200);
    const payload = (await verifyResponse.json()) as Record<string, unknown>;
    expect(payload.status).toBe("success");
    expect(payload.accessToken).toBeTypeOf("string");
    expect(payload.refreshToken).toBeTypeOf("string");
    const cookies = verifyResponse.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith(`${testConfig.refreshTokenCookieName}=`))).toBe(true);

    const createdUser = await store.getUserByEmail("activate@test.local");
    expect(createdUser).not.toBeNull();
  });
});
