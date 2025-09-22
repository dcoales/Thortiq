import * as Y from 'yjs';

import type {MutationOrigin, ThortiqDocCollections} from './doc';
import {initializeCollections} from './doc';
import type {EdgeRecord, NodeId} from '../types';

export const LOCAL_ORIGIN = Symbol('thortiq.local');
export const REMOTE_ORIGIN = Symbol('thortiq.remote');

const addEdgeArraysToScope = (
  undoManager: Y.UndoManager,
  collections: ThortiqDocCollections
) => {
  collections.edges.forEach((edgeArray) => {
    undoManager.addToScope(edgeArray);
  });
};

const handleEdgeMapChanges = (
  undoManager: Y.UndoManager,
  collections: ThortiqDocCollections
) => {
  const handler = (event: Y.YMapEvent<Y.Array<EdgeRecord>>) => {
    event.changes.keys.forEach((change, key) => {
      if (change.action === 'add' || change.action === 'update') {
        const parentId: NodeId = key;
        const edgeArray = collections.edges.get(parentId);
        if (edgeArray) {
          undoManager.addToScope(edgeArray);
        }
      }
    });
  };

  collections.edges.observe(handler);
  return () => collections.edges.unobserve(handler);
};

export interface UndoManagerContext {
  readonly undoManager: Y.UndoManager;
  readonly detach: () => void;
}

export const createUndoManager = (
  doc: Y.Doc,
  options?: Readonly<{captureTimeout?: number}>
): UndoManagerContext => {
  const collections = initializeCollections(doc);
  const undoManager = new Y.UndoManager(
    [collections.nodes, collections.edges, collections.sessions],
    {
      trackedOrigins: new Set<MutationOrigin>([LOCAL_ORIGIN]),
      captureTimeout: options?.captureTimeout ?? 0
    }
  );

  addEdgeArraysToScope(undoManager, collections);
  const unobserve = handleEdgeMapChanges(undoManager, collections);

  return {
    undoManager,
    detach: () => {
      unobserve();
      undoManager.destroy();
    }
  };
};
