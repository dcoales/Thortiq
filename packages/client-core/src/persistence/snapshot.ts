import * as Y from 'yjs';

import type {SnapshotPersistence} from './types';

export const saveDocSnapshot = async (
  doc: Y.Doc,
  store: SnapshotPersistence
): Promise<void> => {
  const update = Y.encodeStateAsUpdate(doc);
  await store.save({update});
};

export const loadDocSnapshot = async (
  doc: Y.Doc,
  store: SnapshotPersistence
): Promise<boolean> => {
  const snapshot = await store.load();
  if (!snapshot) {
    return false;
  }

  Y.applyUpdate(doc, snapshot.update);
  return true;
};

