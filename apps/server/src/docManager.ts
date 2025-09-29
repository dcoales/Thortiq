import { setTimeout as delay, clearTimeout } from "node:timers";

import { Awareness } from "y-protocols/awareness";
import { messageYjsUpdate } from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

import type { SnapshotStorage } from "./storage/types";

const DEFAULT_PERSIST_DELAY_MS = 5_000;

interface ManagedDoc {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly updateSubscribers: Set<(update: Uint8Array, origin: unknown) => void>;
  readonly awarenessSubscribers: Set<(payload: Uint8Array, origin: unknown) => void>;
  persistTimer: NodeJS.Timeout | null;
}

type AwarenessDelta = {
  added: number[];
  updated: number[];
  removed: number[];
};

export class DocManager {
  private readonly docs = new Map<string, ManagedDoc>();

  constructor(
    private readonly storage: SnapshotStorage,
    private readonly persistDelayMs: number = DEFAULT_PERSIST_DELAY_MS
  ) {}

  async ensureDoc(docId: string): Promise<ManagedDoc> {
    let managed = this.docs.get(docId);
    if (managed) {
      return managed;
    }

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    managed = {
      doc,
      awareness,
      updateSubscribers: new Set(),
      awarenessSubscribers: new Set(),
      persistTimer: null
    };

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      this.schedulePersist(docId, managed!);
      for (const subscriber of managed!.updateSubscribers) {
        subscriber(update, origin);
      }
    });

    awareness.on("update", (delta: AwarenessDelta, origin: unknown) => {
      const { added, updated, removed } = delta;
      const changed = [...added, ...updated, ...removed];
      if (changed.length === 0) {
        return;
      }
      const payload = awarenessProtocol.encodeAwarenessUpdate(awareness, changed);
      for (const subscriber of managed!.awarenessSubscribers) {
        subscriber(payload, origin);
      }
    });

    const snapshot = await this.storage.loadSnapshot(docId);
    if (snapshot && snapshot.byteLength > 0) {
      Y.applyUpdate(doc, snapshot, "snapshot");
    }

    this.docs.set(docId, managed);
    return managed;
  }

  subscribeUpdates(
    docId: string,
    handler: (update: Uint8Array, origin: unknown) => void
  ): () => void {
    const subscribers = this.docs.get(docId)?.updateSubscribers;
    if (!subscribers) {
      throw new Error(`Document ${docId} is not registered`);
    }
    subscribers.add(handler);
    return () => subscribers.delete(handler);
  }

  subscribeAwareness(
    docId: string,
    handler: (payload: Uint8Array, origin: unknown) => void
  ): () => void {
    const subscribers = this.docs.get(docId)?.awarenessSubscribers;
    if (!subscribers) {
      throw new Error(`Document ${docId} is not registered`);
    }
    subscribers.add(handler);
    return () => subscribers.delete(handler);
  }

  applySyncMessage(doc: Y.Doc, data: Uint8Array, origin: unknown): Uint8Array | null {
    const decoder = decoding.createDecoder(data);
    const encoder = encoding.createEncoder();
    const messageType = syncProtocol.readSyncMessage(decoder, encoder, doc, origin);

    if (messageType === messageYjsUpdate) {
      // readSyncMessage already applied the update, broadcast will happen via doc.on('update')
    }

    const reply = encoding.toUint8Array(encoder);
    return reply.byteLength > 0 ? reply : null;
  }

  applyAwarenessUpdate(managed: ManagedDoc, payload: Uint8Array, origin: unknown): void {
    awarenessProtocol.applyAwarenessUpdate(managed.awareness, payload, origin);
  }

  private schedulePersist(docId: string, managed: ManagedDoc): void {
    if (managed.persistTimer) {
      clearTimeout(managed.persistTimer);
    }
    managed.persistTimer = delay(() => {
      managed.persistTimer = null;
      const snapshot = Y.encodeStateAsUpdate(managed.doc);
      void this.storage.saveSnapshot(docId, snapshot).catch((error) => {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error(`[doc-manager] failed to persist snapshot for ${docId}`, error);
        }
      });
    }, this.persistDelayMs);
  }
}
