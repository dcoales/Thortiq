export interface SnapshotStorage {
  loadSnapshot(docId: string): Promise<Uint8Array | null>;
  saveSnapshot(docId: string, snapshot: Uint8Array): Promise<void>;
}
