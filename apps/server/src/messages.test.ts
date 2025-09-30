import { describe, expect, it } from "vitest";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

import { MESSAGE_SYNC, writeUpdateMessage } from "./messages";

describe("message encoding", () => {
  it("encodes updates with a length prefix", () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "Hello");
    const update = Y.encodeStateAsUpdate(doc);

    const payload = writeUpdateMessage(update);
    const decoder = decoding.createDecoder(payload);

    const messageType = decoding.readVarUint(decoder);
    expect(messageType).toBe(MESSAGE_SYNC);

    const syncMessageType = decoding.readVarUint(decoder);
    expect(syncMessageType).toBe(syncProtocol.messageYjsUpdate);

    const decodedUpdate = decoding.readVarUint8Array(decoder);
    expect(decodedUpdate).toStrictEqual(update);
    expect(decoding.hasContent(decoder)).toBe(false);
  });
});
