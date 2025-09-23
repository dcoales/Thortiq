/** @jest-environment node */

import 'fake-indexeddb/auto';

import {deserialize, serialize} from 'node:v8';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

import {createIndexedDbSnapshotStore} from '../persistence/indexedDbSnapshotStore';
import {createFileSystemSnapshotStore} from '../persistence/fileSystemSnapshotStore';
import {createSqlJsSnapshotStore} from '../persistence/sqlJsSnapshotStore';
import {
  createEdgeId,
  createNodeId,
  createThortiqDoc,
  ensureDocumentRoot,
  initializeCollections,
  insertEdgeRecord,
  saveDocSnapshot,
  loadDocSnapshot,
  upsertNodeRecord
} from '..';

if (typeof globalThis.structuredClone !== 'function') {
  const fallbackClone = <T>(value: T): T => {
    const buffer = serialize(value);
    return deserialize(buffer) as T;
  };
  (globalThis as typeof globalThis & {structuredClone: typeof fallbackClone}).structuredClone = fallbackClone;
}

const seedDocument = () => {
  const doc = createThortiqDoc();
  const documentRoot = ensureDocumentRoot(doc);
  const nodeId = createNodeId();
  const now = new Date().toISOString();

  upsertNodeRecord(doc, {
    id: nodeId,
    html: 'Persisted node',
    tags: [],
    attributes: {},
    createdAt: now,
    updatedAt: now
  });

  insertEdgeRecord(doc, {
    id: createEdgeId(),
    parentId: documentRoot.id,
    childId: nodeId,
    role: 'primary',
    collapsed: false,
    ordinal: 0,
    selected: false,
    createdAt: now,
    updatedAt: now
  });

  return {doc, nodeId, rootId: documentRoot.id};
};

const expectNodeToExist = (doc: ReturnType<typeof createThortiqDoc>, nodeId: string) => {
  const {nodes} = initializeCollections(doc);
  const node = nodes.get(nodeId);
  expect(node?.html).toBe('Persisted node');
};

describe('Snapshot persistence adapters', () => {
  test('IndexedDB snapshot store saves and loads snapshots', async () => {
    const databaseName = `thortiq-test-${Date.now()}`;
    const store = createIndexedDbSnapshotStore({databaseName});
    const {doc, nodeId} = seedDocument();
    await saveDocSnapshot(doc, store);

    const reloadStore = createIndexedDbSnapshotStore({databaseName});
    const snapshotCheck = await reloadStore.load();
    expect(snapshotCheck).not.toBeNull();
    const restored = createThortiqDoc();
    const loaded = await loadDocSnapshot(restored, reloadStore);
    expect(loaded).toBe(true);
    expectNodeToExist(restored, nodeId);

    await reloadStore.clear?.();
  });

  test('File system snapshot store persists snapshots to disk', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'thortiq-fs-'));
    const storePath = join(directory, 'snapshot.bin');
    const store = createFileSystemSnapshotStore(storePath);

    const {doc, nodeId} = seedDocument();
    await saveDocSnapshot(doc, store);

    const snapshotCheck = await store.load();
    expect(snapshotCheck).not.toBeNull();

    const restored = createThortiqDoc();
    const loadedFromStore = await loadDocSnapshot(restored, store);
    expect(loadedFromStore).toBe(true);
    expectNodeToExist(restored, nodeId);

    await store.clear?.();
    const clearedSnapshot = await store.load();
    expect(clearedSnapshot).toBeNull();

    await rm(directory, {recursive: true, force: true});
  });

  test('SQL.js snapshot store keeps snapshots in SQLite file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'thortiq-sqljs-'));
    const storePath = join(directory, 'snapshot.sqlite');
    const firstStore = await createSqlJsSnapshotStore({filePath: storePath});

    const source = seedDocument();
    await saveDocSnapshot(source.doc, firstStore);

    const restored = createThortiqDoc();
    await loadDocSnapshot(restored, firstStore);
    expectNodeToExist(restored, source.nodeId);

    const secondStore = await createSqlJsSnapshotStore({filePath: storePath});
    const restoredFromDisk = createThortiqDoc();
    await loadDocSnapshot(restoredFromDisk, secondStore);
    expectNodeToExist(restoredFromDisk, source.nodeId);

    await secondStore.clear?.();
    const snapshotAfterClear = await secondStore.load();
    expect(snapshotAfterClear).toBeNull();

    await rm(directory, {recursive: true, force: true});
  });
});
