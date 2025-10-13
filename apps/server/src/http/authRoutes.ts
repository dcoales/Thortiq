import { parse } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { AuthServerConfig } from "../config";
import type { AuthService } from "../services/authService";
import type { PasswordResetService } from "../services/passwordResetService";
import type { GoogleAuthService } from "../services/googleAuthService";
import type { MfaService } from "../services/mfaService";
import type { TokenService } from "../security/tokenService";
import type { Logger } from "../logger";
import type { SecurityAlertService } from "../services/securityAlertService";
import type { RegistrationService } from "../services/registrationService";
import { RegistrationError } from "../services/registrationService";
import { parseCookies, readJsonBody, sendJson, serializeCookie } from "./utils";
import { createSyncToken } from "../auth";

interface AuthRouterDependencies {
  readonly config: AuthServerConfig;
  readonly authService: AuthService;
  readonly passwordResetService: PasswordResetService;
  readonly registrationService: RegistrationService;
  readonly googleAuthService: GoogleAuthService | null;
  readonly mfaService: MfaService;
  readonly tokenService: TokenService;
  readonly logger: Logger;
  readonly securityAlerts: SecurityAlertService;
}

interface LoginBody {
  readonly identifier: string;
  readonly password: string;
  readonly deviceId?: string;
  readonly deviceDisplayName: string;
  readonly platform: string;
  readonly remember?: boolean;
  readonly mfaCode?: string;
  readonly mfaMethodId?: string;
}

interface RefreshBody {
  readonly refreshToken?: string;
}

interface PasswordResetBody {
  readonly identifier: string;
}

interface SubmitResetBody {
  readonly token: string;
  readonly password: string;
}

interface GoogleBody {
  readonly idToken: string;
  readonly deviceId?: string;
  readonly deviceDisplayName: string;
  readonly platform: string;
  readonly remember?: boolean;
  readonly mfaCode?: string;
  readonly mfaMethodId?: string;
}

interface RegistrationBody {
  readonly identifier: string;
  readonly password: string;
  readonly remember?: boolean;
  readonly deviceId?: string;
  readonly deviceDisplayName: string;
  readonly platform: string;
  readonly locale?: string;
  readonly consents?: {
    readonly termsAccepted?: boolean;
    readonly privacyAccepted?: boolean;
    readonly marketingOptIn?: boolean;
  };
}

interface RegistrationResendBody {
  readonly identifier: string;
}

interface RegistrationVerifyBody {
  readonly token: string;
  readonly remember?: boolean;
  readonly deviceId?: string;
  readonly deviceDisplayName: string;
  readonly platform: string;
}

interface MfaVerifyBody {
  readonly userId: string;
  readonly code: string;
  readonly methodId?: string;
}

interface RevokeSessionBody {
  readonly sessionId?: string;
}

interface TotpStartBody {
  readonly label?: string;
}

interface TotpVerifyBody {
  readonly methodId: string;
  readonly code: string;
}

interface BackupCodesBody {
  readonly methodId: string;
}

interface DeleteMfaBody {
  readonly methodId: string;
}

const getIpAddress = (req: IncomingMessage): string | undefined => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0]?.trim();
  }
  if (Array.isArray(forwarded)) {
    return forwarded[0];
  }
  return req.socket.remoteAddress ?? undefined;
};

const buildRefreshCookie = (config: AuthServerConfig, token: string, expiresAt: number): string => {
  return serializeCookie(config.refreshTokenCookieName, token, {
    httpOnly: true,
    secure: !config.securityHeaders.allowInsecureCookies,
    sameSite: "Lax",
    path: "/",
    expiresAt
  });
};

const expireRefreshCookie = (config: AuthServerConfig): string => {
  return serializeCookie(config.refreshTokenCookieName, "", {
    httpOnly: true,
    secure: !config.securityHeaders.allowInsecureCookies,
    sameSite: "Lax",
    path: "/",
    maxAgeSeconds: 0
  });
};

const buildCorsHeaders = (req: IncomingMessage, config: AuthServerConfig, preflight: boolean): Record<string, string> | null => {
  const origin = req.headers.origin;
  if (!origin) {
    return null;
  }
  const allowed = config.cors.allowedOrigins;
  if (!allowed.includes("*") && !allowed.includes(origin)) {
    return null;
  }
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin"
  };
  if (config.cors.allowCredentials) {
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  if (preflight) {
    headers["Access-Control-Allow-Methods"] = req.headers["access-control-request-method"]?.toString() ?? "GET,POST,OPTIONS";
    headers["Access-Control-Allow-Headers"] =
      req.headers["access-control-request-headers"]?.toString() ?? "Content-Type, Authorization, X-Captcha-Token";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
};

const respondJson = (
  req: IncomingMessage,
  res: ServerResponse,
  deps: AuthRouterDependencies,
  data: unknown,
  options: { status?: number; headers?: Record<string, string> } = {}
) => {
  const corsHeaders = buildCorsHeaders(req, deps.config, false);
  const headers = {
    ...(corsHeaders ?? {}),
    ...(options.headers ?? {})
  };
  sendJson(res, data, {
    status: options.status,
    headers
  });
};

const unauthorized = (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  respondJson(
    req,
    res,
    deps,
    {
      error: "unauthorized"
    },
    { status: 401 }
  );
};

const forbidden = (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  respondJson(
    req,
    res,
    deps,
    {
      error: "forbidden"
    },
    { status: 403 }
  );
};

const applySecurityHeaders = (config: AuthServerConfig, res: ServerResponse) => {
  if (config.securityHeaders.enableHsts) {
    res.setHeader("Strict-Transport-Security", `max-age=${config.securityHeaders.hstsMaxAgeSeconds}; includeSubDomains`);
  }
};

const applyCorsHeaders = (req: IncomingMessage, res: ServerResponse, config: AuthServerConfig) => {
  const corsHeaders = buildCorsHeaders(req, config, false);
  if (!corsHeaders) {
    return;
  }
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }
};

const applySecurityAndCors = (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  applySecurityHeaders(deps.config, res);
  applyCorsHeaders(req, res, deps.config);
};

type VerifiedAccessTokenClaims = NonNullable<ReturnType<TokenService["verifyAccessToken"]>>;

const requireAuthenticatedAccess = (
  req: IncomingMessage,
  res: ServerResponse,
  deps: AuthRouterDependencies
): { claims: VerifiedAccessTokenClaims; token: string } | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    unauthorized(req, res, deps);
    return null;
  }
  const token = authHeader.slice("Bearer ".length);
  const claims = deps.tokenService.verifyAccessToken(token);
  if (!claims) {
    unauthorized(req, res, deps);
    return null;
  }
  return { claims, token };
};

export const createAuthRouter = (dependencies: AuthRouterDependencies) => {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = parse(req.url ?? "", true);
    if (!url.pathname) {
      return false;
    }
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "OPTIONS" && path.startsWith("/auth")) {
      const corsHeaders = buildCorsHeaders(req, dependencies.config, true);
      const headers = {
        ...(corsHeaders ?? {}),
        "Content-Length": "0"
      };
      res.writeHead(204, headers);
      res.end();
      return true;
    }

    try {
      switch (`${req.method ?? "GET"} ${path}`) {
        case "POST /auth/register":
          applySecurityAndCors(req, res, dependencies);
          await handleRegistration(req, res, dependencies);
          return true;
        case "POST /auth/register/resend":
          applySecurityAndCors(req, res, dependencies);
          await handleRegistrationResend(req, res, dependencies);
          return true;
        case "POST /auth/register/verify":
          applySecurityAndCors(req, res, dependencies);
          await handleRegistrationVerify(req, res, dependencies);
          return true;
        case "POST /auth/login":
          applySecurityAndCors(req, res, dependencies);
          await handleLogin(req, res, dependencies);
          return true;
        case "POST /auth/refresh":
          applySecurityAndCors(req, res, dependencies);
          await handleRefresh(req, res, dependencies);
          return true;
        case "POST /auth/logout":
          applySecurityAndCors(req, res, dependencies);
          await handleLogout(req, res, dependencies, false);
          return true;
        case "POST /auth/logout-all":
          applySecurityAndCors(req, res, dependencies);
          await handleLogout(req, res, dependencies, true);
          return true;
        case "POST /auth/forgot":
          applySecurityAndCors(req, res, dependencies);
          await handleForgotPassword(req, res, dependencies);
          return true;
        case "POST /auth/reset":
          applySecurityAndCors(req, res, dependencies);
          await handleResetPassword(req, res, dependencies);
          return true;
        case "POST /auth/google":
          if (!dependencies.googleAuthService) {
            forbidden(req, res, dependencies);
            return true;
          }
          applySecurityAndCors(req, res, dependencies);
          await handleGoogleLogin(req, res, dependencies);
          return true;
        case "POST /auth/mfa/verify":
          applySecurityAndCors(req, res, dependencies);
          await handleMfaVerify(req, res, dependencies);
          return true;
        case "GET /auth/sessions":
          applySecurityAndCors(req, res, dependencies);
          await handleListSessions(req, res, dependencies);
          return true;
        case "POST /auth/sessions/revoke":
          applySecurityAndCors(req, res, dependencies);
          await handleRevokeSession(req, res, dependencies);
          return true;
        case "GET /auth/mfa/methods":
          applySecurityAndCors(req, res, dependencies);
          await handleListMfaMethods(req, res, dependencies);
          return true;
        case "POST /auth/mfa/totp/start":
          applySecurityAndCors(req, res, dependencies);
          await handleTotpStart(req, res, dependencies);
          return true;
        case "POST /auth/mfa/totp/verify":
          applySecurityAndCors(req, res, dependencies);
          await handleTotpVerify(req, res, dependencies);
          return true;
        case "POST /auth/mfa/backup/regenerate":
          applySecurityAndCors(req, res, dependencies);
          await handleBackupCodes(req, res, dependencies);
          return true;
        case "DELETE /auth/mfa/methods":
          applySecurityAndCors(req, res, dependencies);
          await handleDeleteMfaMethod(req, res, dependencies);
          return true;
        default:
          return false;
      }
    } catch (error) {
      dependencies.logger.error("Auth route failed", {
        path,
        method: req.method,
        error: error instanceof Error ? error.message : "unknown"
      });
      applyCorsHeaders(req, res, dependencies.config);
      sendJson(
        res,
        {
          error: "internal_error"
        },
        { status: 500 }
      );
      return true;
    }
  };
};

const handleLogin = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const body = (await readJsonBody<LoginBody>(req)) ?? ({} as LoginBody);
  if (!body.identifier || !body.password || !body.deviceDisplayName || !body.platform) {
    sendJson(res, { error: "invalid_request" }, { status: 400 });
    return;
  }

  if (deps.config.captcha.enabled && !req.headers["x-captcha-token"]) {
    sendJson(res, { error: "captcha_required" }, { status: 400 });
    return;
  }

  const ipAddress = getIpAddress(req);
  const result = await deps.authService.login({
    identifier: body.identifier,
    password: body.password,
    deviceId: body.deviceId,
    deviceDisplayName: body.deviceDisplayName,
    platform: body.platform,
    rememberDevice: body.remember ?? false,
    userAgent: req.headers["user-agent"],
    ipAddress,
    mfaCode: body.mfaCode,
    mfaMethodId: body.mfaMethodId
  });

  if (result.status === "failure") {
    sendJson(res, { error: result.reason }, { status: 401 });
    return;
  }

  if (result.status === "mfa_required") {
    sendJson(
      res,
      {
        status: "mfa_required",
        methods: result.methods
      },
      { status: 401 }
    );
    return;
  }

  res.setHeader(
    "Set-Cookie",
    buildRefreshCookie(deps.config, result.refreshToken, result.refreshExpiresAt)
  );

  const syncToken = createSyncToken(result.user.id, { sharedSecret: deps.config.sharedSecret });

  sendJson(res, {
    status: "success",
    accessToken: result.tokens.accessToken,
    expiresAt: result.tokens.expiresAt,
    issuedAt: result.tokens.issuedAt,
    refreshExpiresAt: result.refreshExpiresAt,
    refreshToken: result.refreshToken,
    syncToken,
    user: {
      id: result.user.id,
      email: result.user.email,
      displayName: result.user.displayName
    },
    mfaCompleted: result.mfaCompleted
  });
};

const handleRefresh = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const cookies = parseCookies(req.headers.cookie);
  const body = (await readJsonBody<RefreshBody>(req)) ?? {};
  const token = body.refreshToken ?? cookies[deps.config.refreshTokenCookieName];
  if (!token) {
    unauthorized(req, res, deps);
    return;
  }

  const result = await deps.authService.refresh({
    refreshToken: token,
    userAgent: req.headers["user-agent"],
    ipAddress: getIpAddress(req),
    rememberDevice: true
  });

  if (result.status === "invalid" || !result.tokens || !result.refreshToken) {
    unauthorized(req, res, deps);
    return;
  }

  res.setHeader(
    "Set-Cookie",
    buildRefreshCookie(deps.config, result.refreshToken, result.refreshExpiresAt ?? result.tokens.expiresAt)
  );

  const sessionUserId = result.session?.userId;
  if (!sessionUserId) {
    sendJson(res, { error: "server_error" }, { status: 500 });
    return;
  }
  const syncToken = createSyncToken(sessionUserId, { sharedSecret: deps.config.sharedSecret });

  sendJson(res, {
    accessToken: result.tokens.accessToken,
    expiresAt: result.tokens.expiresAt,
    issuedAt: result.tokens.issuedAt,
    refreshExpiresAt: result.refreshExpiresAt ?? result.tokens.expiresAt,
    refreshToken: result.refreshToken,
    syncToken
  });
};

const handleLogout = async (
  req: IncomingMessage,
  res: ServerResponse,
  deps: AuthRouterDependencies,
  revokeAll: boolean
) => {
  const auth = requireAuthenticatedAccess(req, res, deps);
  if (!auth) {
    return;
  }
  const { claims } = auth;

  await deps.authService.logout({
    sessionId: claims.sessionId,
    userId: claims.sub,
    revokeAll
  });

  res.setHeader("Set-Cookie", expireRefreshCookie(deps.config));
  sendJson(res, { status: "ok" });
};

const handleForgotPassword = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const body = (await readJsonBody<PasswordResetBody>(req)) ?? { identifier: "" };
  if (!body.identifier) {
    sendJson(res, { status: "accepted" });
    return;
  }
  if (deps.config.captcha.enabled && !req.headers["x-captcha-token"]) {
    sendJson(res, { status: "captcha_required" }, { status: 400 });
    return;
  }
  const result = await deps.passwordResetService.requestReset({
    identifier: body.identifier,
    ipAddress: getIpAddress(req),
    userAgent: req.headers["user-agent"]
  });

  if (!result.accepted) {
    sendJson(res, { status: "rate_limited" }, { status: 429 });
    return;
  }

  // Do not reveal whether the user exists.
  sendJson(res, { status: "accepted" });
};

const handleResetPassword = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const body = (await readJsonBody<SubmitResetBody>(req)) ?? { token: "", password: "" };
  if (!body.token || !body.password) {
    sendJson(res, { error: "invalid_request" }, { status: 400 });
    return;
  }

  const result = await deps.passwordResetService.resetPassword({
    token: body.token,
    newPassword: body.password
  });

  if (!result.success) {
    sendJson(res, { error: "invalid_token" }, { status: 400 });
    return;
  }

  res.setHeader("Set-Cookie", expireRefreshCookie(deps.config));
  sendJson(res, { status: "success" });
};

const handleRegistration = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const body = (await readJsonBody<RegistrationBody>(req)) ?? ({} as RegistrationBody);
  if (!body.identifier || !body.password || !body.deviceDisplayName || !body.platform) {
    sendJson(res, { error: "invalid_request", message: "Missing required registration fields." }, { status: 400 });
    return;
  }
  if (!body.consents?.termsAccepted || !body.consents?.privacyAccepted) {
    sendJson(
      res,
      { error: "consent_required", message: "You need to accept the Terms and Privacy Policy to continue." },
      { status: 400 }
    );
    return;
  }

  try {
    const result = await deps.registrationService.requestRegistration({
      identifier: body.identifier,
      password: body.password,
      rememberDevice: body.remember ?? false,
      deviceDisplayName: body.deviceDisplayName,
      devicePlatform: body.platform,
      deviceId: body.deviceId,
      locale: body.locale,
      consents: {
        termsAccepted: Boolean(body.consents?.termsAccepted),
        privacyAccepted: Boolean(body.consents?.privacyAccepted),
        marketingOptIn: Boolean(body.consents?.marketingOptIn)
      },
      ipAddress: getIpAddress(req),
      userAgent: req.headers["user-agent"],
      origin: req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/')
    });

    sendJson(
      res,
      {
        status: "pending",
        verificationExpiresAt: result.verificationExpiresAt,
        resendAvailableAt: result.resendAvailableAt
      },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof RegistrationError) {
      if (error.retryAfterMs) {
        res.setHeader("Retry-After", Math.max(1, Math.ceil(error.retryAfterMs / 1000)).toString());
      }
      switch (error.code) {
        case "rate_limited":
          sendJson(res, { error: "rate_limited" }, { status: 429 });
          return;
        case "invalid_password":
        case "invalid_email":
          sendJson(res, { error: error.code, message: error.message }, { status: 400 });
          return;
        default:
          sendJson(res, { error: "server_error", message: "Could not process registration." }, { status: 500 });
          return;
      }
    }

    deps.logger.error("Registration request failed", {
      error: error instanceof Error ? error.message : "unknown"
    });
    sendJson(res, { error: "server_error", message: "Could not process registration." }, { status: 500 });
  }
};

const handleRegistrationResend = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const body = (await readJsonBody<RegistrationResendBody>(req)) ?? { identifier: "" };
  if (!body.identifier) {
    sendJson(res, { error: "invalid_request" }, { status: 400 });
    return;
  }

  try {
    const result = await deps.registrationService.resendRegistration({
      identifier: body.identifier,
      ipAddress: getIpAddress(req),
      origin: req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/')
    });

    sendJson(
      res,
      {
        status: "pending",
        verificationExpiresAt: result.verificationExpiresAt,
        resendAvailableAt: result.resendAvailableAt
      },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof RegistrationError) {
      if (error.retryAfterMs) {
        res.setHeader("Retry-After", Math.max(1, Math.ceil(error.retryAfterMs / 1000)).toString());
      }
      if (error.code === "rate_limited") {
        sendJson(res, { error: "rate_limited" }, { status: 429 });
        return;
      }
      sendJson(res, { error: "server_error" }, { status: 500 });
      return;
    }

    deps.logger.error("Registration resend failed", {
      error: error instanceof Error ? error.message : "unknown"
    });
    sendJson(res, { error: "server_error" }, { status: 500 });
  }
};

const handleRegistrationVerify = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const body = (await readJsonBody<RegistrationVerifyBody>(req)) ?? ({} as RegistrationVerifyBody);
  if (!body.token || !body.deviceDisplayName || !body.platform) {
    sendJson(res, { error: "invalid_request" }, { status: 400 });
    return;
  }

  try {
    const result = await deps.registrationService.verifyRegistration({
      token: body.token,
      rememberDevice: body.remember ?? false,
      deviceDisplayName: body.deviceDisplayName,
      devicePlatform: body.platform,
      deviceId: body.deviceId,
      ipAddress: getIpAddress(req),
      userAgent: req.headers["user-agent"]
    });

    res.setHeader("Set-Cookie", buildRefreshCookie(deps.config, result.refreshToken, result.refreshExpiresAt));
    const syncToken = createSyncToken(result.user.id, { sharedSecret: deps.config.sharedSecret });
    sendJson(res, {
      status: "success",
      accessToken: result.tokens.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.tokens.expiresAt,
      issuedAt: result.tokens.issuedAt,
      refreshExpiresAt: result.refreshExpiresAt,
      syncToken,
      sessionId: result.session.id,
      deviceId: result.device.id,
      device: {
        id: result.device.id,
        displayName: result.device.displayName,
        platform: result.device.platform,
        trusted: result.device.trusted
      },
      user: {
        id: result.user.id,
        email: result.user.email,
        displayName: result.user.displayName
      },
      mfaCompleted: result.mfaCompleted
    });
  } catch (error) {
    if (error instanceof RegistrationError) {
      if (error.retryAfterMs) {
        res.setHeader("Retry-After", Math.max(1, Math.ceil(error.retryAfterMs / 1000)).toString());
      }
      switch (error.code) {
        case "rate_limited":
          sendJson(res, { error: "rate_limited" }, { status: 429 });
          return;
        case "invalid_password":
        case "invalid_email":
          sendJson(res, { error: error.code, message: error.message }, { status: 400 });
          return;
        case "token_invalid":
          sendJson(res, { error: "invalid_token" }, { status: 400 });
          return;
        case "token_expired":
          sendJson(res, { error: "token_expired" }, { status: 410 });
          return;
        default:
          sendJson(res, { error: "server_error" }, { status: 500 });
          return;
      }
    }

    deps.logger.error("Registration verification failed", {
      error: error instanceof Error ? error.message : "unknown"
    });
    sendJson(res, { error: "server_error" }, { status: 500 });
  }
};

const handleGoogleLogin = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const body = (await readJsonBody<GoogleBody>(req)) ?? ({} as GoogleBody);
  if (!body.idToken || !body.deviceDisplayName || !body.platform) {
    sendJson(res, { error: "invalid_request" }, { status: 400 });
    return;
  }

  if (!deps.googleAuthService) {
    forbidden(req, res, deps);
    return;
  }

  if (deps.config.captcha.enabled && !req.headers["x-captcha-token"]) {
    sendJson(res, { error: "captcha_required" }, { status: 400 });
    return;
  }

  const result = await deps.googleAuthService.signIn({
    idToken: body.idToken,
    deviceId: body.deviceId,
    deviceDisplayName: body.deviceDisplayName,
    platform: body.platform,
    rememberDevice: body.remember ?? true,
    userAgent: req.headers["user-agent"],
    ipAddress: getIpAddress(req),
    mfaCode: body.mfaCode,
    mfaMethodId: body.mfaMethodId
  });

  if (result.status === "mfa_required") {
    sendJson(
      res,
      {
        status: "mfa_required",
        methods: result.methods
      },
      { status: 401 }
    );
    return;
  }

  if (result.status === "failure") {
    sendJson(res, { error: result.reason }, { status: 401 });
    return;
  }

  res.setHeader(
    "Set-Cookie",
    buildRefreshCookie(deps.config, result.refreshToken, result.refreshExpiresAt)
  );

  const syncToken = createSyncToken(result.user.id, { sharedSecret: deps.config.sharedSecret });

  sendJson(res, {
    accessToken: result.tokens.accessToken,
    expiresAt: result.tokens.expiresAt,
    issuedAt: result.tokens.issuedAt,
    refreshExpiresAt: result.refreshExpiresAt,
    refreshToken: result.refreshToken,
    syncToken,
    user: {
      id: result.user.id,
      email: result.user.email,
      displayName: result.user.displayName
    },
    mfaCompleted: result.mfaCompleted
  });
};

const handleMfaVerify = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const body = (await readJsonBody<MfaVerifyBody>(req)) ?? ({} as MfaVerifyBody);
  if (!body.userId || !body.code) {
    sendJson(res, { error: "invalid_request" }, { status: 400 });
    return;
  }
  const result = await deps.mfaService.verifyChallenge({
    userId: body.userId,
    code: body.code,
    methodId: body.methodId
  });
  if (!result.success) {
    sendJson(res, { error: "invalid_code" }, { status: 400 });
    return;
  }
  sendJson(res, {
    status: "success",
    methodId: result.method?.id,
    usedBackupCode: result.usedBackupCode ?? false
  });
};

const handleListSessions = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const auth = requireAuthenticatedAccess(req, res, deps);
  if (!auth) {
    return;
  }
  const sessions = await deps.authService.listSessions(auth.claims.sub, auth.claims.sessionId);
  sendJson(res, { sessions });
};

const handleRevokeSession = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const auth = requireAuthenticatedAccess(req, res, deps);
  if (!auth) {
    return;
  }
  const body = (await readJsonBody<RevokeSessionBody>(req)) ?? {};
  if (!body.sessionId) {
    sendJson(res, { error: "invalid_request" }, { status: 400 });
    return;
  }
  await deps.authService.logout({
    sessionId: body.sessionId,
    userId: auth.claims.sub,
    revokeAll: false
  });
  sendJson(res, { status: "ok" });
};

const handleListMfaMethods = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const auth = requireAuthenticatedAccess(req, res, deps);
  if (!auth) {
    return;
  }
  const summaries = await deps.mfaService.listMethodSummaries(auth.claims.sub);
  sendJson(res, { methods: summaries });
};

const handleTotpStart = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const auth = requireAuthenticatedAccess(req, res, deps);
  if (!auth) {
    return;
  }
  const body = (await readJsonBody<TotpStartBody>(req)) ?? {};
  const profile = await deps.authService.getUserProfile(auth.claims.sub);
  const label = body.label ?? profile?.email ?? "Thortiq";
  const { challenge } = await deps.mfaService.createTotpEnrollment(auth.claims.sub, label);
  sendJson(res, { challenge });
};

const handleTotpVerify = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const auth = requireAuthenticatedAccess(req, res, deps);
  if (!auth) {
    return;
  }
  const body = (await readJsonBody<TotpVerifyBody>(req)) ?? ({ methodId: "", code: "" } as TotpVerifyBody);
  if (!body.methodId || !body.code) {
    sendJson(res, { error: "invalid_request" }, { status: 400 });
    return;
  }
  const methods = await deps.mfaService.listActiveMethods(auth.claims.sub);
  const method = methods.find((candidate) => candidate.id === body.methodId);
  if (!method) {
    sendJson(res, { error: "not_found" }, { status: 404 });
    return;
  }
  const wasVerified = Boolean(method.verifiedAt);
  const result = await deps.mfaService.verifyTotpMethod(method, body.code);
  if (!result.success) {
    sendJson(res, { error: "invalid_code" }, { status: 400 });
    return;
  }
  if (!wasVerified) {
    void deps.securityAlerts.notifyMfaMethodAdded({
      userId: auth.claims.sub,
      methodId: method.id,
      methodType: method.type,
      deviceId: auth.claims.deviceId,
      sessionId: auth.claims.sessionId
    });
  }
  sendJson(res, { status: "success" });
};

const handleBackupCodes = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const auth = requireAuthenticatedAccess(req, res, deps);
  if (!auth) {
    return;
  }
  const body = (await readJsonBody<BackupCodesBody>(req)) ?? ({ methodId: "" } as BackupCodesBody);
  if (!body.methodId) {
    sendJson(res, { error: "invalid_request" }, { status: 400 });
    return;
  }
  const methods = await deps.mfaService.listActiveMethods(auth.claims.sub);
  const method = methods.find((candidate) => candidate.id === body.methodId && candidate.type === "totp");
  if (!method) {
    sendJson(res, { error: "not_found" }, { status: 404 });
    return;
  }
  const codes = await deps.mfaService.regenerateBackupCodes(auth.claims.sub, method.id);
  sendJson(res, { status: "success", codes });
};

const handleDeleteMfaMethod = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const auth = requireAuthenticatedAccess(req, res, deps);
  if (!auth) {
    return;
  }
  const body = (await readJsonBody<DeleteMfaBody>(req)) ?? ({ methodId: "" } as DeleteMfaBody);
  if (!body.methodId) {
    sendJson(res, { error: "invalid_request" }, { status: 400 });
    return;
  }
  const methods = await deps.mfaService.listActiveMethods(auth.claims.sub);
  const method = methods.find((candidate) => candidate.id === body.methodId);
  if (!method) {
    sendJson(res, { error: "not_found" }, { status: 404 });
    return;
  }
  await deps.mfaService.removeMethod(auth.claims.sub, method.id);
  void deps.securityAlerts.notifyMfaMethodRemoved({
    userId: auth.claims.sub,
    methodId: method.id,
    methodType: method.type
  });
  sendJson(res, { status: "success" });
};
