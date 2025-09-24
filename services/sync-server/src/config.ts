export interface SyncServerOptions {
  readonly port?: number;
  readonly jwtSecret: string;
  readonly allowedOrigins?: readonly string[];
  readonly heartbeatTimeoutMs?: number;
}

export interface DocumentIdentifiers {
  readonly docId: string;
}

