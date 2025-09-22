export interface DocSnapshot {
  readonly update: Uint8Array;
}

export interface SnapshotPersistence {
  readonly load: () => Promise<DocSnapshot | null>;
  readonly save: (snapshot: DocSnapshot) => Promise<void>;
  readonly clear?: () => Promise<void>;
}

