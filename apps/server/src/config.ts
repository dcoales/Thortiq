import type { AuthEnvironmentConfig } from "@thortiq/client-core";
import * as path from "path";

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

export interface RegistrationConfig {
  readonly tokenLifetimeSeconds: number;
  readonly resendCooldownSeconds: number;
  readonly maxResendAttempts: number;
  readonly windowSeconds: number;
  readonly maxRequestsPerWindow: number;
  readonly verificationBaseUrl: string;
  readonly devMailboxPath: string | null;
}

export interface CorsConfig {
  readonly allowedOrigins: ReadonlyArray<string>;
  readonly allowCredentials: boolean;
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

export interface MfaConfig {
  readonly totpIssuer: string;
  readonly secretKey: string;
  readonly enrollmentWindowSeconds: number;
}

export interface SecurityAlertConfig {
  readonly enabled: boolean;
}

export interface TlsConfig {
  readonly certPath: string;
  readonly keyPath: string;
  readonly passphrase?: string;
}

export interface WebAuthnConfig {
  readonly rpId: string;
  readonly rpName: string;
  readonly origin: string;
  readonly challengeTimeoutSeconds: number;
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
  readonly registration: RegistrationConfig;
  readonly cors: CorsConfig;
  readonly captcha: CaptchaConfig;
  readonly securityHeaders: SecurityHeadersConfig;
  readonly mfa: MfaConfig;
  readonly securityAlerts: SecurityAlertConfig;
  readonly webauthn: WebAuthnConfig;
  readonly tls: TlsConfig | null;
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
  const databasePath = env.AUTH_DATABASE_PATH ?? path.join(process.env.HOME ?? process.cwd(), ".thortiq", "dev-auth.sqlite");
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

  const rpId = env.AUTH_WEBAUTHN_RP_ID ?? "localhost";
  const rpName = env.AUTH_WEBAUTHN_RP_NAME ?? "Thortiq";
  const rpOrigin = env.AUTH_WEBAUTHN_ORIGIN ?? `http://${rpId}:3000`;
  const webauthnTimeoutSeconds = toInt(env.AUTH_WEBAUTHN_TIMEOUT_SECONDS, 120);

  const registrationTokenLifetime = toInt(env.AUTH_REGISTRATION_TOKEN_SECONDS, 15 * 60);
  const registrationResendCooldown = toInt(env.AUTH_REGISTRATION_RESEND_SECONDS, 60);
  const registrationMaxResendAttempts = toInt(env.AUTH_REGISTRATION_MAX_RESENDS, 5);
  const registrationWindowSeconds = toInt(env.AUTH_REGISTRATION_WINDOW_SECONDS, 60 * 60);
  const registrationMaxPerWindow = toInt(env.AUTH_REGISTRATION_MAX_PER_WINDOW, 5);
  const registrationBaseUrl = env.AUTH_REGISTRATION_VERIFY_URL ?? `${rpOrigin.replace(/\/$/, "")}/register/verify`;
  const registrationMailboxPath = env.AUTH_REGISTRATION_DEV_MAILBOX ?? `${process.cwd()}/coverage/dev-mailbox`;

  let corsAllowedOrigins: string[] = [];
  if (env.AUTH_CORS_ALLOWED_ORIGINS) {
    corsAllowedOrigins = env.AUTH_CORS_ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  } else if (process.env.NODE_ENV !== "production") {
    corsAllowedOrigins = ["http://localhost:5173"];
  }

  const captchaEnabled = boolFromEnv(env.AUTH_CAPTCHA_ENABLED, false);

  const allowInsecureCookies = boolFromEnv(env.AUTH_ALLOW_INSECURE_COOKIES, process.env.NODE_ENV !== "production");

  const totpIssuer = env.AUTH_MFA_TOTP_ISSUER ?? "Thortiq";
  const mfaSecretKey = requireEnv(env, "AUTH_MFA_SECRET_KEY", "dev-mfa-secret");
  const mfaEnrollmentWindowSeconds = toInt(env.AUTH_MFA_ENROLLMENT_SECONDS, 10 * 60);

  const securityAlertsEnabled = boolFromEnv(env.AUTH_SECURITY_ALERTS_ENABLED, true);

  const authEnvironment: AuthEnvironmentConfig = {
    jwtIssuer: env.AUTH_JWT_ISSUER ?? "https://api.thortiq.local",
    jwtAudience: env.AUTH_JWT_AUDIENCE ?? "thortiq-clients",
    accessTokenLifetimeSeconds: accessLifetime,
    refreshTokenLifetimeSeconds: refreshTrusted,
    trustedDeviceLifetimeSeconds: trustedDeviceLifetime
  };

  const tlsCertPath = env.SYNC_TLS_CERT_PATH?.trim();
  const tlsKeyPath = env.SYNC_TLS_KEY_PATH?.trim();
  const tlsPassphrase = env.SYNC_TLS_PASSPHRASE?.trim();

  const tlsConfig: TlsConfig | null =
    tlsCertPath && tlsKeyPath
      ? {
          certPath: tlsCertPath,
          keyPath: tlsKeyPath,
          passphrase: tlsPassphrase && tlsPassphrase.length > 0 ? tlsPassphrase : undefined
        }
      : null;

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
    registration: {
      tokenLifetimeSeconds: registrationTokenLifetime,
      resendCooldownSeconds: registrationResendCooldown,
      maxResendAttempts: registrationMaxResendAttempts,
      windowSeconds: registrationWindowSeconds,
      maxRequestsPerWindow: registrationMaxPerWindow,
      verificationBaseUrl: registrationBaseUrl,
      devMailboxPath: registrationMailboxPath ? registrationMailboxPath : null
    },
    cors: {
      allowedOrigins: corsAllowedOrigins,
      allowCredentials: true
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
    },
    mfa: {
      totpIssuer,
      secretKey: mfaSecretKey,
      enrollmentWindowSeconds: mfaEnrollmentWindowSeconds
    },
    securityAlerts: {
      enabled: securityAlertsEnabled
    },
    webauthn: {
      rpId,
      rpName,
      origin: rpOrigin,
      challengeTimeoutSeconds: webauthnTimeoutSeconds
    },
    tls: tlsConfig
  };
};
