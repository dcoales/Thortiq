import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import { parse } from "node:url";
import { setInterval, clearInterval } from "node:timers";

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { ServerResponse } from "node:http";

import { DocManager } from "./docManager";
import { createS3SnapshotStorage } from "./storage/s3";
import { InMemorySnapshotStorage } from "./storage/inMemory";
import { verifyAuthorizationHeader, verifySyncToken } from "./auth";
import type { SnapshotStorage } from "./storage/types";
import {
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  writeAwarenessMessage,
  writeMessage,
  writeUpdateMessage
} from "./messages";
import { authorizeDocAccess } from "./namespaces";
import { loadConfig } from "./config";
import { createConsoleLogger } from "./logger";
import { SqliteIdentityStore } from "./identity/sqliteStore";
import { Argon2PasswordHasher } from "./security/passwordHasher";
import { SlidingWindowRateLimiter } from "./security/rateLimiter";
import { TokenService } from "./security/tokenService";
import { SecretVault } from "./security/secretVault";
import { createAuthRouter } from "./http/authRoutes";
import { PasswordResetService } from "./services/passwordResetService";
import { MfaService } from "./services/mfaService";
import { SessionManager } from "./services/sessionService";
import { AuthService } from "./services/authService";
import { DeviceService } from "./services/deviceService";
import { GoogleAuthService } from "./services/googleAuthService";
import { LoggingSecurityAlertChannel, SecurityAlertService } from "./services/securityAlertService";
import { RegistrationService } from "./services/registrationService";

type WebSocketLike = NodeJS.EventEmitter & {
  send(data: ArrayBufferLike | Buffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  terminate?: () => void;
  ping?: () => void;
  on(event: "message", listener: (data: ArrayBuffer | Buffer) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (error: unknown) => void): void;
};

type WebSocketServerType = {
  handleUpgrade(
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
    callback: (socket: WebSocketLike) => void
  ): void;
  on(
    event: "connection",
    listener: (socket: WebSocketLike, request: IncomingMessage, info: { docId: string; userId: string }) => void
  ): void;
  emit(
    event: "connection",
    socket: WebSocketLike,
    request: IncomingMessage,
    info: { docId: string; userId: string }
  ): boolean;
  close(callback?: () => void): void;
  readonly clients: Set<WebSocketLike>;
};

interface ServerOptions {
  readonly port?: number;
  readonly snapshotStorage?: SnapshotStorage;
  readonly sharedSecret?: string;
  readonly s3Bucket?: string;
  readonly s3Region?: string;
  readonly s3Prefix?: string;
  readonly databasePath?: string;
}

const getDocIdFromRequest = (req: IncomingMessage): string | null => {
  const url = parse(req.url ?? "");
  if (!url.pathname) {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const raw = segments[segments.length - 1];
  if (!raw) {
    return null;
  }
  try {
    return decodeURIComponent(raw);
  } catch (_error) {
    return raw;
  }
};

const createSnapshotStorage = (options: ServerOptions): SnapshotStorage => {
  if (options.snapshotStorage) {
    return options.snapshotStorage;
  }
  if (options.s3Bucket) {
    return createS3SnapshotStorage({
      bucket: options.s3Bucket,
      region: options.s3Region,
      prefix: options.s3Prefix
    });
  }
  return new InMemorySnapshotStorage();
};

type WsModule = { WebSocketServer: new (options: { noServer?: boolean }) => WebSocketServerType };

const getWebSocketServer = async (): Promise<WebSocketServerType> => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - ws is an optional runtime dependency resolved in production
  const module = (await import("ws")) as WsModule;
  return new module.WebSocketServer({ noServer: true });
};

const noop = () => {};

interface ConnectionContext {
  readonly socket: WebSocketLike;
  readonly userId: string;
  readonly docId: string;
  heartbeatTimer: NodeJS.Timeout | null;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

const setupHeartbeat = (connection: ConnectionContext) => {
  const sendPing = () => {
    try {
      connection.socket.ping?.();
    } catch (_error) {
      connection.socket.terminate?.();
    }
  };
  connection.heartbeatTimer = setInterval(sendPing, HEARTBEAT_INTERVAL_MS);
};

const clearHeartbeat = (connection: ConnectionContext) => {
  if (connection.heartbeatTimer) {
    clearInterval(connection.heartbeatTimer);
    connection.heartbeatTimer = null;
  }
};

export const createSyncServer = async (options: ServerOptions) => {
  const config = loadConfig();
  const logger = createConsoleLogger();
  const storage = createSnapshotStorage(options);
  const manager = new DocManager(storage);

  const databasePath = options.databasePath ?? config.databasePath;
  const identityStore = new SqliteIdentityStore({ path: databasePath });
  const passwordHasher = new Argon2PasswordHasher({
    memoryCost: config.passwordPolicy.argonMemoryCost,
    timeCost: config.passwordPolicy.argonTimeCost,
    parallelism: config.passwordPolicy.argonParallelism,
    pepper: config.passwordPolicy.pepper
  });
  const tokenService = new TokenService({
    authEnvironment: config.authEnvironment,
    accessTokenSecret: config.jwt.accessTokenSecret,
    refreshTokenPolicy: config.refreshTokenPolicy
  });
  const secretVault = new SecretVault({
    secretKey: config.mfa.secretKey
  });
  const sessionManager = new SessionManager({
    identityStore,
    tokenService,
    trustedDeviceLifetimeSeconds: config.trustedDeviceLifetimeSeconds
  });
  const deviceService = new DeviceService(identityStore);
  const securityAlerts = new SecurityAlertService({
    enabled: config.securityAlerts.enabled,
    logger
  });
  securityAlerts.registerChannel(new LoggingSecurityAlertChannel(logger));
  const mfaService = new MfaService({
    identityStore,
    logger,
    window: 1,
    vault: secretVault,
    totpIssuer: config.mfa.totpIssuer,
    enrollmentWindowSeconds: config.mfa.enrollmentWindowSeconds
  });
  const authService = new AuthService({
    identityStore,
    passwordHasher,
    tokenService,
    mfaService,
    logger,
    sessionManager,
    deviceService,
    securityAlerts
  });

  const rateLimiterPerIdentifier = new SlidingWindowRateLimiter({
    windowSeconds: config.forgotPassword.windowSeconds,
    maxAttempts: config.forgotPassword.maxRequestsPerWindow
  });
  const rateLimiterPerIp = new SlidingWindowRateLimiter({
    windowSeconds: config.forgotPassword.windowSeconds,
    maxAttempts: config.forgotPassword.maxRequestsPerWindow
  });

  const passwordResetService = new PasswordResetService({
    identityStore,
    passwordHasher,
    logger,
    tokenLifetimeSeconds: config.forgotPassword.tokenLifetimeSeconds,
    rateLimiterPerIdentifier,
    rateLimiterPerIp
  });

  const registrationIdentifierLimiter = new SlidingWindowRateLimiter({
    windowSeconds: config.registration.windowSeconds,
    maxAttempts: config.registration.maxRequestsPerWindow
  });
  const registrationIpLimiter = new SlidingWindowRateLimiter({
    windowSeconds: config.registration.windowSeconds,
    maxAttempts: config.registration.maxRequestsPerWindow
  });

  const registrationService = new RegistrationService({
    identityStore,
    passwordHasher,
    sessionManager,
    deviceService,
    logger,
    securityAlerts,
    rateLimiterPerIdentifier: registrationIdentifierLimiter,
    rateLimiterPerIp: registrationIpLimiter,
    config: config.registration
  });

  const googleAuthService = config.google
    ? new GoogleAuthService({
        identityStore,
        sessionManager,
        deviceService,
        config: config.google,
        logger,
        mfaService,
        securityAlerts
      })
    : null;

  const authRouter = createAuthRouter({
    config,
    authService,
    passwordResetService,
    registrationService,
    googleAuthService,
    mfaService,
    tokenService,
    logger,
    securityAlerts
  });

  const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.url === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (await authRouter(req, res)) {
        return;
      }

      res.writeHead(404);
      res.end();
    } catch (error) {
      logger.error("Unhandled error processing request", {
        error: error instanceof Error ? error.message : "unknown"
      });
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "server_error" }));
    }
  };

  const server = (() => {
    if (!config.tls) {
      return http.createServer(requestHandler);
    }

    try {
      const key = readFileSync(config.tls.keyPath);
      const cert = readFileSync(config.tls.certPath);
      const tlsOptions = config.tls.passphrase
        ? { key, cert, passphrase: config.tls.passphrase }
        : { key, cert };
      logger.info("Starting sync server with TLS", { certPath: config.tls.certPath });
      return https.createServer(tlsOptions, requestHandler);
    } catch (error) {
      logger.error("Failed to load TLS certificates", {
        certPath: config.tls.certPath,
        keyPath: config.tls.keyPath,
        error: error instanceof Error ? error.message : "unknown"
      });
      throw error;
    }
  })();

  const wss = await getWebSocketServer();

  const connections = new WeakMap<WebSocketLike, ConnectionContext>();

  const sharedSecret = options.sharedSecret ?? config.sharedSecret;
  if (!sharedSecret) {
    throw new Error("Shared secret is required for sync server authentication");
  }

  const authOptions = {
    sharedSecret
  };

  const listenPort = options.port ?? config.port;

  server.on("upgrade", async (req, socket, head) => {
    const docId = getDocIdFromRequest(req);
    if (!docId) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    const requestUrl = new URL(req.url ?? "", "http://localhost");
    const queryToken = requestUrl.searchParams.get("token") ?? undefined;
    const authResult =
      verifyAuthorizationHeader(req.headers.authorization, authOptions)
      ?? verifySyncToken(queryToken, authOptions);
    if (!authResult) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const access = authorizeDocAccess(docId, authResult.userId);
    if (!access) {
      logger.warn("Unauthorized doc access", { docId, userId: authResult.userId });
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    try {
      await manager.ensureDoc(access.docId);
    } catch (error) {
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
      if (typeof console !== "undefined" && typeof console.error === "function") {
        console.error("[sync-server] failed to initialize document", error);
      }
      return;
    }

    wss.handleUpgrade(req, socket as unknown as Socket, head, (ws) => {
      wss.emit("connection", ws, req, { docId: access.docId, userId: authResult.userId });
    });
  });

  wss.on("connection", async (socket: WebSocketLike, _req: IncomingMessage, info: { docId: string; userId: string }) => {
    const { docId, userId } = info;
    const managed = await manager.ensureDoc(docId);
    const connection: ConnectionContext = { socket, userId, docId, heartbeatTimer: null };
    connections.set(socket, connection);
    setupHeartbeat(connection);

    const unsubscribeUpdates = manager.subscribeUpdates(docId, (update, origin) => {
      if (origin === socket) {
        return;
      }
      try {
        socket.send(writeUpdateMessage(update));
      } catch (error) {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          console.warn("[sync-server] failed to send update", error);
        }
      }
    });

    const unsubscribeAwareness = manager.subscribeAwareness(docId, (payload, origin) => {
      if (origin === socket) {
        return;
      }
      try {
        socket.send(writeAwarenessMessage(payload));
      } catch (error) {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          console.warn("[sync-server] failed to send awareness", error);
        }
      }
    });

    socket.on("message", (data: ArrayBuffer | Buffer) => {
      const buffer = data instanceof Buffer ? new Uint8Array(data) : new Uint8Array(data);
      const decoder = decoding.createDecoder(buffer);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        const yMessage = decoding.readTailAsUint8Array(decoder);
        const reply = manager.applySyncMessage(managed.doc, yMessage, socket);
        if (reply) {
          socket.send(writeMessage(MESSAGE_SYNC, (encoder) => {
            reply.forEach((byte) => {
              encoding.writeUint8(encoder, byte);
            });
          }));
        }
        return;
      }

      if (messageType === MESSAGE_AWARENESS) {
        const payload = decoding.readVarUint8Array(decoder);
        try {
          manager.applyAwarenessUpdate(managed, payload, socket);
        } catch (error) {
          if (typeof console !== "undefined" && typeof console.warn === "function") {
            const preview = Buffer.from(payload.slice(0, Math.min(32, payload.byteLength))).toString("hex");
            const base64 = Buffer.from(payload).toString("base64");
            console.warn("[sync-server] dropped malformed awareness payload", error, {
              bytes: payload.byteLength,
              previewHex: preview,
              payloadBase64: base64
            });
          }
          try {
            socket.close(1003, "Invalid awareness payload");
          } catch (_closeError) {
            socket.terminate?.();
          }
          connections.delete(socket);
        }
        return;
      }
    });

    socket.on("close", () => {
      unsubscribeUpdates();
      unsubscribeAwareness();
      clearHeartbeat(connection);
      managed.awareness.setLocalStateField?.("status", "offline");
      connections.delete(socket);
    });

    socket.on("error", noop);

    const encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(encoder, managed.doc);
    socket.send(writeMessage(MESSAGE_SYNC, (innerEncoder) => {
      encoding.writeUint8Array(innerEncoder, encoding.toUint8Array(encoder));
    }));

    const awarenessState = managed.awareness.getStates();
    if (awarenessState.size > 0) {
      const payload = awarenessProtocol.encodeAwarenessUpdate(
        managed.awareness,
        Array.from(awarenessState.keys())
      );
      socket.send(writeAwarenessMessage(payload));
    }
  });

  return {
    server,
    wss,
    async start() {
      return await new Promise<void>((resolve) => {
        server.listen(listenPort, resolve);
      });
    },
    async stop() {
      await new Promise<void>((resolve) => {
        wss.clients.forEach((client) => {
          client.close();
        });
        wss.close(() => {
          server.close(() => {
            identityStore.close();
            resolve();
          });
        });
      });
    }
  };
};

if (process.env.NODE_ENV !== "test") {
  const runtimeConfig = loadConfig();

  void (async () => {
    const syncServer = await createSyncServer({
      sharedSecret: runtimeConfig.sharedSecret,
      port: runtimeConfig.port,
      s3Bucket: process.env.S3_BUCKET,
      s3Region: process.env.AWS_REGION,
      s3Prefix: process.env.S3_PREFIX
    });
    await syncServer.start();
    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log(`Sync server listening on port ${runtimeConfig.port}`);
    }
  })();
}
