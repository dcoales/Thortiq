import cors from 'cors';
import express, {Router} from 'express';
import type {Express} from 'express';
import {createServer as createHttpServer} from 'http';
import type {IncomingMessage, Server as HttpServer} from 'http';
import type {AddressInfo} from 'net';
import {WebSocketServer, type WebSocket} from 'ws';

import {createAuthMiddleware, verifyToken} from './auth';
import type {SyncServerOptions} from './config';
import {SharedDocStore} from './docStore';
import {createDocumentRouter} from './routes/documents';
import {createProfileRouter} from './routes/profile';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {setupWSConnection} = require('y-websocket/bin/utils') as {
  setupWSConnection: (
    socket: WebSocket,
    request: IncomingMessage,
    options?: {docName?: string; gc?: boolean}
  ) => void;
};

interface HeartbeatSocket extends WebSocket {
  isAlive?: boolean;
}

export interface SyncServer {
  readonly app: Express;
  readonly httpServer: HttpServer;
  readonly wss: WebSocketServer;
  readonly store: SharedDocStore;
  start: (port?: number) => Promise<number>;
  stop: () => Promise<void>;
}

const parseConnectionUrl = (requestUrl: string, host?: string) => {
  const baseUrl = host ? `http://${host}` : 'http://localhost';
  return new URL(requestUrl, baseUrl);
};

const applyCors = (app: Express, allowedOrigins?: readonly string[]) => {
  if (!allowedOrigins || allowedOrigins.length === 0) {
    app.use(cors());
    return;
  }
  const originList = Array.from(allowedOrigins);
  app.use(
    cors({
      origin: originList,
      credentials: true
    })
  );
};

export const createSyncServer = (options: SyncServerOptions): SyncServer => {
  if (!options.jwtSecret) {
    throw new Error('Sync server requires a JWT secret');
  }

  const store = new SharedDocStore();
  const app = express();
  applyCors(app, options.allowedOrigins);
  app.use(express.json({limit: '1mb'}));

  const healthRouter = Router();
  healthRouter.get('/', (_, res) => {
    res.json({status: 'ok'});
  });
  app.use('/health', healthRouter);

  const authMiddleware = createAuthMiddleware(options.jwtSecret);
  const protectedRouter = Router();
  protectedRouter.use(authMiddleware);
  protectedRouter.use('/profile', createProfileRouter());
  protectedRouter.use('/documents', createDocumentRouter(store));
  app.use('/api', protectedRouter);

  const httpServer = createHttpServer(app);
  const wss = new WebSocketServer({server: httpServer});

  const heartbeatIntervalMs = options.heartbeatTimeoutMs ?? 30000;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  const scheduleHeartbeat = () => {
    if (heartbeatTimer) {
      return;
    }
    heartbeatTimer = setInterval(() => {
      wss.clients.forEach((socket) => {
        const hbSocket = socket as HeartbeatSocket;
        if (hbSocket.isAlive === false) {
          socket.terminate();
          return;
        }
        hbSocket.isAlive = false;
        socket.ping();
      });
    }, heartbeatIntervalMs);
  };

  wss.on('connection', (socket: HeartbeatSocket, request) => {
    try {
      const url = parseConnectionUrl(request.url ?? '/', request.headers.host ?? undefined);
      const docName = url.pathname.replace(/^\//, '') || 'default';
      const token = url.searchParams.get('token');
      if (!token) {
        socket.close(4001, 'missing_token');
        return;
      }
      verifyToken(options.jwtSecret, token);
      store.get(docName);
      setupWSConnection(socket, request, {docName, gc: true});
      socket.isAlive = true;
      socket.on('pong', () => {
        socket.isAlive = true;
      });
      scheduleHeartbeat();
    } catch (error) {
      socket.close(4001, 'invalid_token');
    }
  });

  const start = (port?: number) =>
    new Promise<number>((resolve, reject) => {
      const listenPort = port ?? options.port ?? 5001;
      httpServer.once('error', reject);
      httpServer.listen(listenPort, () => {
        const info = httpServer.address() as AddressInfo;
        resolve(info.port);
      });
    });

  let isStopped = false;

  const stop = () => {
    if (isStopped) {
      return Promise.resolve();
    }
    isStopped = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    const closeWebSocket = () =>
      new Promise<void>((resolve) => {
        wss.clients.forEach((client) => client.terminate());
        wss.close(() => resolve());
      });

    const closeHttpServer = () =>
      new Promise<void>((resolve, reject) => {
        if (!httpServer.listening) {
          resolve();
          return;
        }
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

    return Promise.all([closeWebSocket(), closeHttpServer()]).then(() => undefined);
  };

  return {
    app,
    httpServer,
    wss,
    store,
    start,
    stop
  };
};
