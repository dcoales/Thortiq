import http from "node:http";
import { parse } from "node:url";
import { setInterval, clearInterval } from "node:timers";

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import { DocManager } from "./docManager";
import { createS3SnapshotStorage } from "./storage/s3";
import { InMemorySnapshotStorage } from "./storage/inMemory";
import { verifyAuthorizationHeader, verifySyncToken } from "./auth";
import type { SnapshotStorage } from "./storage/types";

type WebSocketLike = NodeJS.EventEmitter & {
  send(data: ArrayBufferLike | Buffer | Uint8Array): void;
  close(code?: number): void;
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

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

interface ServerOptions {
  readonly port?: number;
  readonly snapshotStorage?: SnapshotStorage;
  readonly sharedSecret: string;
  readonly s3Bucket?: string;
  readonly s3Region?: string;
  readonly s3Prefix?: string;
}

const getDocIdFromRequest = (req: IncomingMessage): string | null => {
  const url = parse(req.url ?? "");
  if (!url.pathname) {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const docId = segments[segments.length - 1];
  return docId ?? null;
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

const writeMessage = (type: number, payloadWriter: (encoder: encoding.Encoder) => void): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  payloadWriter(encoder);
  return encoding.toUint8Array(encoder);
};

const writeUpdateMessage = (update: Uint8Array): Uint8Array => {
  return writeMessage(MESSAGE_SYNC, (encoder) => {
    encoding.writeVarUint(encoder, syncProtocol.messageYjsUpdate);
    encoding.writeUint8Array(encoder, update);
  });
};

const writeAwarenessMessage = (payload: Uint8Array): Uint8Array => {
  return writeMessage(MESSAGE_AWARENESS, (encoder) => {
    encoding.writeUint8Array(encoder, payload);
  });
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
  const storage = createSnapshotStorage(options);
  const manager = new DocManager(storage);
  const server = http.createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = await getWebSocketServer();

  const connections = new WeakMap<WebSocketLike, ConnectionContext>();

  const authOptions = {
    sharedSecret: options.sharedSecret
  };

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

    try {
      await manager.ensureDoc(docId);
    } catch (error) {
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
      if (typeof console !== "undefined" && typeof console.error === "function") {
        console.error("[sync-server] failed to initialize document", error);
      }
      return;
    }

    wss.handleUpgrade(req, socket as unknown as Socket, head, (ws) => {
      wss.emit("connection", ws, req, { docId, userId: authResult.userId });
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
            encoding.writeUint8Array(encoder, reply);
          }));
        }
        return;
      }

      if (messageType === MESSAGE_AWARENESS) {
        const payload = decoding.readTailAsUint8Array(decoder);
        manager.applyAwarenessUpdate(managed, payload, socket);
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
        server.listen(options.port ?? Number(process.env.PORT ?? 1234), resolve);
      });
    },
    async stop() {
      await new Promise<void>((resolve) => {
        wss.clients.forEach((client) => {
          client.close();
        });
        wss.close(() => {
          server.close(() => resolve());
        });
      });
    }
  };
};

if (process.env.NODE_ENV !== "test") {
  const sharedSecret = process.env.SYNC_SHARED_SECRET;
  if (!sharedSecret) {
    throw new Error("SYNC_SHARED_SECRET environment variable is required");
  }

  void (async () => {
    const syncServer = await createSyncServer({
      sharedSecret,
      s3Bucket: process.env.S3_BUCKET,
      s3Region: process.env.AWS_REGION,
      s3Prefix: process.env.S3_PREFIX
    });
    await syncServer.start();
    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log(`Sync server listening on port ${process.env.PORT ?? 1234}`);
    }
  })();
}
