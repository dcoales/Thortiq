import type { AuthEnvironmentConfig } from "@thortiq/client-core";

interface RawEnv {
  readonly [key: string]: string | undefined;
}

export interface JwtSecrets {
  readonly accessTokenSecret: string;
  readonly refreshTokenSecret: string;
}

export interface RefreshTokenPolicy {
  readonly trustedSeconds: number;
  readonly untrustedSeconds: number;
}

export interface PasswordPolicy {
  readonly argonMemoryCost: number;
  readonly argonTimeCost: number;
  readonly argonParallelism: number;
  readonly pepper: string;
}

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly jwksUri: string;
  readonly audience: string;
  readonly issuer: string;
  readonly clockToleranceSeconds: number;
}

export interface ForgotPasswordPolicy {
  readonly tokenLifetimeSeconds: number;
  readonly maxRequestsPerWindow: number;
  readonly windowSeconds: number;
}

export interface CaptchaConfig {
  readonly enabled: boolean;
  readonly siteKey?: string;
  readonly secretKey?: string;
}

export interface SecurityHeadersConfig {
  readonly enableHsts: boolean;
  readonly hstsMaxAgeSeconds: number;
  readonly allowInsecureCookies: boolean;
}

export interface AuthServerConfig {
  readonly port: number;
  readonly databasePath: string;
  readonly sharedSecret: string;
  readonly jwt: JwtSecrets;
  readonly authEnvironment: AuthEnvironmentConfig;
  readonly refreshTokenPolicy: RefreshTokenPolicy;
  readonly passwordPolicy: PasswordPolicy;
  readonly refreshTokenCookieName: string;
  readonly trustedDeviceLifetimeSeconds: number;
  readonly google: GoogleOAuthConfig | null;
  readonly forgotPassword: ForgotPasswordPolicy;
  readonly captcha: CaptchaConfig;
  readonly securityHeaders: SecurityHeadersConfig;
}

const toInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const boolFromEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  if (value === "1" || value?.toLowerCase() === "true") {
    return true;
  }
  if (value === "0" || value?.toLowerCase() === "false") {
    return false;
  }
  return fallback;
};

const requireEnv = (env: RawEnv, key: string, fallback?: string): string => {
  const value = env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment value ${key}`);
  }
  return value;
};

export const loadConfig = (env: RawEnv = process.env): AuthServerConfig => {
  const port = toInt(env.PORT, 1234);
  const databasePath = env.AUTH_DATABASE_PATH ?? ":memory:";
  const jwtAccessSecret = requireEnv(env, "AUTH_JWT_ACCESS_SECRET", "dev-access-secret");
  const jwtRefreshSecret = requireEnv(env, "AUTH_JWT_REFRESH_SECRET", "dev-refresh-secret");
  const pepper = requireEnv(env, "AUTH_PASSWORD_PEPPER", "dev-password-pepper");
  const sharedSecret = requireEnv(env, "SYNC_SHARED_SECRET", "local-dev-secret");

  const accessLifetime = toInt(env.AUTH_ACCESS_TOKEN_SECONDS, 15 * 60);
  const refreshTrusted = toInt(env.AUTH_REFRESH_TOKEN_TRUSTED_SECONDS, 30 * 24 * 60 * 60);
  const refreshUntrusted = toInt(env.AUTH_REFRESH_TOKEN_UNTRUSTED_SECONDS, 12 * 60 * 60);
  const trustedDeviceLifetime = toInt(env.AUTH_TRUSTED_DEVICE_SECONDS, 30 * 24 * 60 * 60);

  const googleClientId = env.AUTH_GOOGLE_CLIENT_ID;
  const googleAudience = env.AUTH_GOOGLE_AUDIENCE ?? googleClientId;
  const googleIssuer = env.AUTH_GOOGLE_ISSUER ?? "https://accounts.google.com";
  const googleJwks = env.AUTH_GOOGLE_JWKS_URI ?? "https://www.googleapis.com/oauth2/v3/certs";

  const forgotWindowSeconds = toInt(env.AUTH_FORGOT_WINDOW_SECONDS, 60 * 60);
  const forgotMaxPerWindow = toInt(env.AUTH_FORGOT_MAX_PER_WINDOW, 5);
  const forgotTokenLifetime = toInt(env.AUTH_FORGOT_TOKEN_SECONDS, 15 * 60);

  const captchaEnabled = boolFromEnv(env.AUTH_CAPTCHA_ENABLED, false);

  const allowInsecureCookies = boolFromEnv(env.AUTH_ALLOW_INSECURE_COOKIES, process.env.NODE_ENV !== "production");

  const authEnvironment: AuthEnvironmentConfig = {
    jwtIssuer: env.AUTH_JWT_ISSUER ?? "https://api.thortiq.local",
    jwtAudience: env.AUTH_JWT_AUDIENCE ?? "thortiq-clients",
    accessTokenLifetimeSeconds: accessLifetime,
    refreshTokenLifetimeSeconds: refreshTrusted,
    trustedDeviceLifetimeSeconds: trustedDeviceLifetime
  };

  return {
    port,
    databasePath,
    sharedSecret,
    jwt: {
      accessTokenSecret: jwtAccessSecret,
      refreshTokenSecret: jwtRefreshSecret
    },
    authEnvironment,
    refreshTokenPolicy: {
      trustedSeconds: refreshTrusted,
      untrustedSeconds: refreshUntrusted
    },
    passwordPolicy: {
      argonMemoryCost: toInt(env.AUTH_ARGON_MEMORY_COST, 19456),
      argonTimeCost: toInt(env.AUTH_ARGON_TIME_COST, 2),
      argonParallelism: toInt(env.AUTH_ARGON_PARALLELISM, 1),
      pepper
    },
    refreshTokenCookieName: env.AUTH_REFRESH_COOKIE_NAME ?? "thortiq-refresh",
    trustedDeviceLifetimeSeconds: trustedDeviceLifetime,
    google: googleClientId
      ? {
          clientId: googleClientId,
          audience: googleAudience ?? googleClientId,
          issuer: googleIssuer,
          jwksUri: googleJwks,
          clockToleranceSeconds: toInt(env.AUTH_GOOGLE_CLOCK_TOLERANCE_SECONDS, 60)
        }
      : null,
    forgotPassword: {
      tokenLifetimeSeconds: forgotTokenLifetime,
      maxRequestsPerWindow: forgotMaxPerWindow,
      windowSeconds: forgotWindowSeconds
    },
    captcha: {
      enabled: captchaEnabled,
      siteKey: env.AUTH_CAPTCHA_SITE_KEY,
      secretKey: env.AUTH_CAPTCHA_SECRET_KEY
    },
    securityHeaders: {
      enableHsts: boolFromEnv(env.AUTH_ENABLE_HSTS, process.env.NODE_ENV === "production"),
      hstsMaxAgeSeconds: toInt(env.AUTH_HSTS_SECONDS, 365 * 24 * 60 * 60),
      allowInsecureCookies
    }
  };
};
