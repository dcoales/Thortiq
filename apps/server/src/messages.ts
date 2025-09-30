/**
 * Internal helpers to encode sync server payloads shared across connection handlers and tests.
 * The functions ensure binary protocols stay aligned with the expectations of the web client.
 */
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

export const writeMessage = (
  type: number,
  payloadWriter: (encoder: encoding.Encoder) => void
): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  payloadWriter(encoder);
  return encoding.toUint8Array(encoder);
};

export const writeUpdateMessage = (update: Uint8Array): Uint8Array => {
  return writeMessage(MESSAGE_SYNC, (encoder) => {
    encoding.writeVarUint(encoder, syncProtocol.messageYjsUpdate);
    encoding.writeVarUint8Array(encoder, update);
  });
};

export const writeAwarenessMessage = (payload: Uint8Array): Uint8Array => {
  return writeMessage(MESSAGE_AWARENESS, (encoder) => {
    encoding.writeVarUint8Array(encoder, payload);
  });
};
