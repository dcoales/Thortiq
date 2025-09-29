import type { IncomingMessage } from "http";
import type { Socket } from "net";
import type { EventEmitter } from "events";

declare module "ws" {
  export type RawWebSocket = EventEmitter & {
    send(data: ArrayBufferLike | Buffer | Uint8Array): void;
    close(code?: number): void;
    terminate?: () => void;
    ping?: () => void;
    on(event: "message", listener: (data: ArrayBuffer | Buffer) => void): void;
    on(event: "close", listener: () => void): void;
    on(event: "error", listener: (error: unknown) => void): void;
  };

  export class WebSocketServer {
    constructor(options: { noServer?: boolean });
    handleUpgrade(request: IncomingMessage, socket: Socket, head: Buffer, callback: (socket: RawWebSocket) => void): void;
    on(event: "connection", listener: (socket: RawWebSocket, request: IncomingMessage, info: unknown) => void): void;
    emit(event: "connection", socket: RawWebSocket, request: IncomingMessage, info: unknown): boolean;
    close(callback?: () => void): void;
    readonly clients: Set<RawWebSocket>;
  }
}
