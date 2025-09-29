import type { SnapshotStorage } from "./types";

export class InMemorySnapshotStorage implements SnapshotStorage {
  private readonly store = new Map<string, Uint8Array>();

  async loadSnapshot(docId: string): Promise<Uint8Array | null> {
    const value = this.store.get(docId);
    return value ? new Uint8Array(value) : null;
  }

  async saveSnapshot(docId: string, snapshot: Uint8Array): Promise<void> {
    this.store.set(docId, new Uint8Array(snapshot));
  }
}
