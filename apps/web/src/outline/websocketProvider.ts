import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

import type {
  SyncManagerOptions,
  SyncProviderAdapter,
  SyncProviderContext,
  SyncProviderError,
  SyncProviderStatus
} from "@thortiq/client-core";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_AUTH = 2;

const MESSAGE_YJS_SYNC_STEP1 = 0;
const MESSAGE_YJS_SYNC_STEP2 = 1;
const MESSAGE_YJS_UPDATE = 2;

const DEFAULT_RECONNECT_MIN_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;

const createSyncError = (
  code: string,
  message: string,
  recoverable: boolean,
  cause?: unknown
): SyncProviderError => ({ code, message, recoverable, cause });

const buildEndpointUrl = (base: string, docId: string, token?: string): string => {
  const resolved = base.includes("{docId}")
    ? base.replace("{docId}", encodeURIComponent(docId))
    : `${base.replace(/\/$/, "")}/${encodeURIComponent(docId)}`;

  if (!token) {
    return resolved;
  }

  const url = new URL(resolved, globalThis.location?.href ?? undefined);
  url.searchParams.set("token", token);
  return url.toString();
};

const setBinaryType = (socket: WebSocket): void => {
  try {
    socket.binaryType = "arraybuffer";
  } catch (_error) {
    // ignore when not supported
  }
};

const toUint8Array = (data: ArrayBufferLike | Uint8Array): Uint8Array =>
  data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data);

const randomInRange = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

export interface WebsocketProviderFactoryOptions {
  readonly endpoint: string;
  readonly token?: string;
  readonly minReconnectDelayMs?: number;
  readonly maxReconnectDelayMs?: number;
  readonly protocols?: string | string[];
}

class WebsocketSyncProvider implements SyncProviderAdapter {
  public status: SyncProviderStatus = "disconnected";

  private readonly context: SyncProviderContext;
  private readonly options: Required<Pick<WebsocketProviderFactoryOptions, "endpoint">> &
    Omit<WebsocketProviderFactoryOptions, "endpoint">;

  private socket: WebSocket | null = null;
  private shouldReconnect = true;
  private reconnectTimer: number | null = null;
  private destroyed = false;
  private reconnectAttempts = 0;
  private pendingMessages: Uint8Array[] = [];

  private readonly updateListeners = new Set<(update: Uint8Array) => void>();
  private readonly awarenessListeners = new Set<(payload: Uint8Array) => void>();
  private readonly statusListeners = new Set<(status: SyncProviderStatus) => void>();
  private readonly errorListeners = new Set<(error: SyncProviderError) => void>();

  constructor(context: SyncProviderContext, options: WebsocketProviderFactoryOptions) {
    this.context = context;
    this.options = {
      endpoint: options.endpoint,
      token: options.token,
      minReconnectDelayMs: options.minReconnectDelayMs ?? DEFAULT_RECONNECT_MIN_MS,
      maxReconnectDelayMs: options.maxReconnectDelayMs ?? DEFAULT_RECONNECT_MAX_MS,
      protocols: options.protocols
    };
  }

  connect(): Promise<void> {
    if (this.destroyed) {
      return Promise.reject(new Error("Provider destroyed"));
    }
    this.shouldReconnect = true;
    if (this.socket && (this.status === "connected" || this.status === "connecting")) {
      return Promise.resolve();
    }
    this.openSocket();
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.setStatus("disconnected");
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    this.destroyed = true;
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.updateListeners.clear();
    this.awarenessListeners.clear();
    this.statusListeners.clear();
    this.errorListeners.clear();
    this.pendingMessages = [];
    return Promise.resolve();
  }

  sendUpdate(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.enqueueMessage(encoding.toUint8Array(encoder));
  }

  broadcastAwareness(payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, payload);
    this.enqueueMessage(encoding.toUint8Array(encoder));
  }

  onUpdate(listener: (update: Uint8Array) => void): () => void {
    this.updateListeners.add(listener);
    return () => {
      this.updateListeners.delete(listener);
    };
  }

  onAwareness(listener: (payload: Uint8Array) => void): () => void {
    this.awarenessListeners.add(listener);
    return () => {
      this.awarenessListeners.delete(listener);
    };
  }

  onStatusChange(listener: (status: SyncProviderStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  onError(listener: (error: SyncProviderError) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  private openSocket(): void {
    const { docId } = this.context;
    const url = buildEndpointUrl(this.options.endpoint, docId, this.options.token);

    let socket: WebSocket;
    try {
      socket = new WebSocket(url, this.options.protocols);
    } catch (error) {
      this.emitError(createSyncError("socket-init", "Failed to initialise WebSocket connection", true, error));
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    this.setStatus("connecting");
    this.clearReconnectTimer();

    setBinaryType(socket);

    socket.onopen = () => {
      if (this.destroyed) {
        return;
      }
      this.setStatus("connected");
      this.reconnectAttempts = 0;
      this.flushPendingMessages();
      this.sendSyncStep1();
      this.sendAwarenessSnapshot();
    };

    socket.onerror = (event) => {
      if (this.destroyed) {
        return;
      }
      this.emitError(
        createSyncError("socket-error", "WebSocket connection error", true, (event as ErrorEvent).error)
      );
    };

    socket.onclose = () => {
      if (this.destroyed) {
        return;
      }
      this.socket = null;
      this.setStatus("disconnected");
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };

    socket.onmessage = (event) => {
      if (this.destroyed) {
        return;
      }
      this.handleMessage(event.data);
    };
  }

  private sendSyncStep1(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.context.doc);
    this.enqueueMessage(encoding.toUint8Array(encoder));
  }

  private sendAwarenessSnapshot(): void {
    const state = this.context.awareness.getLocalState();
    if (!state) {
      return;
    }
    const payload = awarenessProtocol.encodeAwarenessUpdate(this.context.awareness, [this.context.awareness.clientID]);
    if (payload.byteLength === 0) {
      return;
    }
    this.broadcastAwareness(payload);
  }

  private handleMessage(data: ArrayBufferLike | Uint8Array): void {
    const decoder = decoding.createDecoder(toUint8Array(data));
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC: {
        this.handleSyncMessage(decoder);
        break;
      }
      case MESSAGE_AWARENESS: {
        const payload = decoding.readVarUint8Array(decoder);
        this.awarenessListeners.forEach((listener) => listener(payload));
        break;
      }
      case MESSAGE_AUTH: {
        // Auth messages can be ignored for now.
        break;
      }
      default: {
        this.emitError(
          createSyncError("unknown-message", `Unknown provider message type: ${messageType}`, true)
        );
      }
    }
  }

  private handleSyncMessage(decoder: decoding.Decoder): void {
    const message = decoding.readVarUint(decoder);

    if (message === MESSAGE_YJS_SYNC_STEP1) {
      const stateVector = decoding.readVarUint8Array(decoder);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep2(encoder, this.context.doc, stateVector);
      this.enqueueMessage(encoding.toUint8Array(encoder));
      return;
    }

    if (message === MESSAGE_YJS_SYNC_STEP2 || message === MESSAGE_YJS_UPDATE) {
      const update = decoding.readVarUint8Array(decoder);
      this.updateListeners.forEach((listener) => listener(update));
      return;
    }

    this.emitError(
      createSyncError("unknown-sync-message", `Unknown sync message type: ${message}`, true)
    );
  }

  private enqueueMessage(payload: Uint8Array): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(payload);
      } catch (error) {
        this.emitError(createSyncError("send-failed", "Failed to send message", true, error));
        this.pendingMessages.push(payload);
      }
      return;
    }
    this.pendingMessages.push(payload);
  }

  private flushPendingMessages(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const queue = this.pendingMessages.splice(0, this.pendingMessages.length);
    queue.forEach((message) => {
      try {
        this.socket?.send(message);
      } catch (error) {
        this.emitError(createSyncError("send-failed", "Failed to send message", true, error));
      }
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.destroyed) {
      return;
    }
    this.reconnectAttempts += 1;
    const min = this.options.minReconnectDelayMs ?? DEFAULT_RECONNECT_MIN_MS;
    const max = this.options.maxReconnectDelayMs ?? DEFAULT_RECONNECT_MAX_MS;
    const delay = Math.min(max, min * 2 ** this.reconnectAttempts);
    const jittered = randomInRange(delay * 0.8, delay);

    this.clearReconnectTimer();
    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect && !this.destroyed) {
        this.openSocket();
      }
    }, jittered) as unknown as number;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      globalThis.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(next: SyncProviderStatus): void {
    if (this.status === next) {
      return;
    }
    this.status = next;
    this.statusListeners.forEach((listener) => listener(next));
  }

  private emitError(error: SyncProviderError): void {
    this.errorListeners.forEach((listener) => listener(error));
  }
}

export const createWebsocketProviderFactory = (
  options: WebsocketProviderFactoryOptions
): SyncManagerOptions["providerFactory"] => {
  return (context: SyncProviderContext): SyncProviderAdapter => new WebsocketSyncProvider(context, options);
};
