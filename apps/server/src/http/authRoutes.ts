import { parse } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { AuthServerConfig } from "../config";
import type { AuthService } from "../services/authService";
import type { PasswordResetService } from "../services/passwordResetService";
import type { GoogleAuthService } from "../services/googleAuthService";
import type { MfaService } from "../services/mfaService";
import type { TokenService } from "../security/tokenService";
import type { Logger } from "../logger";
import { parseCookies, readJsonBody, sendJson, serializeCookie } from "./utils";

interface AuthRouterDependencies {
  readonly config: AuthServerConfig;
  readonly authService: AuthService;
  readonly passwordResetService: PasswordResetService;
  readonly googleAuthService: GoogleAuthService | null;
  readonly mfaService: MfaService;
  readonly tokenService: TokenService;
  readonly logger: Logger;
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
}

interface MfaVerifyBody {
  readonly userId: string;
  readonly code: string;
  readonly methodId?: string;
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

const unauthorized = (res: ServerResponse) => {
  sendJson(
    res,
    {
      error: "unauthorized"
    },
    { status: 401 }
  );
};

const forbidden = (res: ServerResponse) => {
  sendJson(
    res,
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

export const createAuthRouter = (dependencies: AuthRouterDependencies) => {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = parse(req.url ?? "", true);
    if (!url.pathname) {
      return false;
    }
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      switch (`${req.method ?? "GET"} ${path}`) {
        case "POST /auth/login":
          applySecurityHeaders(dependencies.config, res);
          await handleLogin(req, res, dependencies);
          return true;
        case "POST /auth/refresh":
          applySecurityHeaders(dependencies.config, res);
          await handleRefresh(req, res, dependencies);
          return true;
        case "POST /auth/logout":
          applySecurityHeaders(dependencies.config, res);
          await handleLogout(req, res, dependencies, false);
          return true;
        case "POST /auth/logout-all":
          applySecurityHeaders(dependencies.config, res);
          await handleLogout(req, res, dependencies, true);
          return true;
        case "POST /auth/forgot":
          applySecurityHeaders(dependencies.config, res);
          await handleForgotPassword(req, res, dependencies);
          return true;
        case "POST /auth/reset":
          applySecurityHeaders(dependencies.config, res);
          await handleResetPassword(req, res, dependencies);
          return true;
        case "POST /auth/google":
          if (!dependencies.googleAuthService) {
            forbidden(res);
            return true;
          }
          applySecurityHeaders(dependencies.config, res);
          await handleGoogleSignIn(req, res, dependencies);
          return true;
        case "POST /auth/mfa/verify":
          applySecurityHeaders(dependencies.config, res);
          await handleMfaVerify(req, res, dependencies);
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

  sendJson(res, {
    status: "success",
    accessToken: result.tokens.accessToken,
    expiresAt: result.tokens.expiresAt,
    issuedAt: result.tokens.issuedAt,
    refreshExpiresAt: result.refreshExpiresAt,
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
    unauthorized(res);
    return;
  }

  const result = await deps.authService.refresh({
    refreshToken: token,
    userAgent: req.headers["user-agent"],
    ipAddress: getIpAddress(req),
    rememberDevice: true
  });

  if (result.status === "invalid" || !result.tokens || !result.refreshToken) {
    unauthorized(res);
    return;
  }

  res.setHeader(
    "Set-Cookie",
    buildRefreshCookie(deps.config, result.refreshToken, result.refreshExpiresAt ?? result.tokens.expiresAt)
  );

  sendJson(res, {
    accessToken: result.tokens.accessToken,
    expiresAt: result.tokens.expiresAt,
    issuedAt: result.tokens.issuedAt,
    refreshExpiresAt: result.refreshExpiresAt ?? result.tokens.expiresAt
  });
};

const handleLogout = async (
  req: IncomingMessage,
  res: ServerResponse,
  deps: AuthRouterDependencies,
  revokeAll: boolean
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    unauthorized(res);
    return;
  }
  const token = authHeader.slice("Bearer ".length);
  const claims = deps.tokenService.verifyAccessToken(token);
  if (!claims) {
    unauthorized(res);
    return;
  }

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

const handleGoogleSignIn = async (req: IncomingMessage, res: ServerResponse, deps: AuthRouterDependencies) => {
  const body = (await readJsonBody<GoogleBody>(req)) ?? ({} as GoogleBody);
  if (!body.idToken || !body.deviceDisplayName || !body.platform) {
    sendJson(res, { error: "invalid_request" }, { status: 400 });
    return;
  }

  if (!deps.googleAuthService) {
    forbidden(res);
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
    ipAddress: getIpAddress(req)
  });

  res.setHeader(
    "Set-Cookie",
    buildRefreshCookie(deps.config, result.refreshToken, result.refreshExpiresAt)
  );

  sendJson(res, {
    accessToken: result.tokens.accessToken,
    expiresAt: result.tokens.expiresAt,
    issuedAt: result.tokens.issuedAt,
    refreshExpiresAt: result.refreshExpiresAt,
    user: {
      id: result.user.id,
      email: result.user.email,
      displayName: result.user.displayName
    }
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
