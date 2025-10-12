import http from "node:http";

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
import type { UserProfile, CredentialRecord } from "@thortiq/client-core";

const testConfig = loadConfig({
  AUTH_JWT_ACCESS_SECRET: "router-access",
  AUTH_JWT_REFRESH_SECRET: "router-refresh",
  AUTH_PASSWORD_PEPPER: "router-pepper",
  AUTH_DATABASE_PATH: ":memory:",
  AUTH_JWT_ISSUER: "https://router.local",
  AUTH_JWT_AUDIENCE: "router-clients",
  SYNC_SHARED_SECRET: "shared-secret",
  PORT: "0"
});

describe("auth routes", () => {
  let server: http.Server;
  let store: SqliteIdentityStore;
  let address: { port: number };

  beforeEach(async () => {
    store = new SqliteIdentityStore({ path: ":memory:" });
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
    const mfaService = new MfaService({ identityStore: store, logger: createConsoleLogger(), window: 1 });
    const authService = new AuthService({
      identityStore: store,
      passwordHasher,
      tokenService,
      mfaService,
      logger: createConsoleLogger(),
      sessionManager,
      deviceService
    });
    const passwordResetService = new PasswordResetService({
      identityStore: store,
      passwordHasher,
      logger: createConsoleLogger(),
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

    const router = createAuthRouter({
      config: testConfig,
      authService,
      passwordResetService,
      googleAuthService: null,
      mfaService,
      tokenService,
      logger: createConsoleLogger()
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
});
