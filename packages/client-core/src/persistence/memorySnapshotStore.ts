import type {DocSnapshot, SnapshotPersistence} from './types';

export class MemorySnapshotStore implements SnapshotPersistence {
  private snapshot: DocSnapshot | null = null;

  load(): Promise<DocSnapshot | null> {
    const copy = this.snapshot ? {update: new Uint8Array(this.snapshot.update)} : null;
    return Promise.resolve(copy);
  }

  save(snapshot: DocSnapshot): Promise<void> {
    this.snapshot = {update: new Uint8Array(snapshot.update)};
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.snapshot = null;
    return Promise.resolve();
  }
}
