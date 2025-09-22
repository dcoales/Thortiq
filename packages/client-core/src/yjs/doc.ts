import * as Y from 'yjs';

import {createChildResolverFromMap, wouldCreateCycle} from '../invariants';
import type {
  EdgeRecord,
  NodeId,
  NodeRecord,
  SessionId,
  SessionState
} from '../types';
import {EDGES_COLLECTION, NODES_COLLECTION, SESSIONS_COLLECTION} from './constants';

export type MutationOrigin = string | symbol | {readonly source: string};

export interface ThortiqDocCollections {
  readonly nodes: Y.Map<NodeRecord>;
  readonly edges: Y.Map<Y.Array<EdgeRecord>>;
  readonly sessions: Y.Map<SessionState>;
}

export const createThortiqDoc = (): Y.Doc => {
  const doc = new Y.Doc();
  initializeCollections(doc);
  return doc;
};

export const initializeCollections = (doc: Y.Doc): ThortiqDocCollections => {
  const nodes = doc.getMap<NodeRecord>(NODES_COLLECTION);
  const edges = doc.getMap<Y.Array<EdgeRecord>>(EDGES_COLLECTION);
  const sessions = doc.getMap<SessionState>(SESSIONS_COLLECTION);
  return {nodes, edges, sessions};
};

export const transactDoc = <T>(doc: Y.Doc, fn: () => T, origin?: MutationOrigin): T => {
  let result: T | undefined;
  doc.transact(() => {
    result = fn();
  }, origin);
  return result as T;
};

export const upsertNodeRecord = (doc: Y.Doc, node: NodeRecord, origin?: MutationOrigin): void => {
  transactDoc(doc, () => {
    const {nodes} = initializeCollections(doc);
    nodes.set(node.id, node);
  }, origin);
};

export const removeNodeRecord = (doc: Y.Doc, nodeId: NodeId, origin?: MutationOrigin): void => {
  transactDoc(doc, () => {
    const {nodes, edges} = initializeCollections(doc);
    nodes.delete(nodeId);
    edges.delete(nodeId);
  }, origin);
};

export const getNodeRecord = (doc: Y.Doc, nodeId: NodeId): NodeRecord | undefined => {
  const {nodes} = initializeCollections(doc);
  return nodes.get(nodeId);
};

const getOrCreateEdgeArray = (edges: Y.Map<Y.Array<EdgeRecord>>, parentId: NodeId): Y.Array<EdgeRecord> => {
  const existing = edges.get(parentId);
  if (existing) {
    return existing;
  }

  const arr = new Y.Array<EdgeRecord>();
  edges.set(parentId, arr);
  return arr;
};

export const insertEdgeRecord = (doc: Y.Doc, edge: EdgeRecord, origin?: MutationOrigin): void => {
  transactDoc(doc, () => {
    const {edges} = initializeCollections(doc);
    const resolver = createResolverFromDoc(doc);

    if (wouldCreateCycle(resolver, edge.childId, edge.parentId)) {
      throw new Error('Cycle detected while inserting edge');
    }

    const edgeArray = getOrCreateEdgeArray(edges, edge.parentId);

    const ordinalIndex = Math.min(Math.max(edge.ordinal, 0), edgeArray.length);

    edgeArray.insert(ordinalIndex, [edge]);
  }, origin);
};

export const replaceEdgeRecords = (
  doc: Y.Doc,
  parentId: NodeId,
  nextEdges: readonly EdgeRecord[],
  origin?: MutationOrigin
): void => {
  transactDoc(doc, () => {
    const {edges} = initializeCollections(doc);
    const resolver = createResolverFromDoc(doc);

    for (const edge of nextEdges) {
      if (wouldCreateCycle(resolver, edge.childId, parentId)) {
        throw new Error('Cycle detected while replacing edges');
      }
    }

    const edgeArray = getOrCreateEdgeArray(edges, parentId);
    edgeArray.delete(0, edgeArray.length);
    edgeArray.insert(0, [...nextEdges]);
  }, origin);
};

export const removeEdgeRecord = (
  doc: Y.Doc,
  parentId: NodeId,
  predicate: (edge: EdgeRecord) => boolean,
  origin?: MutationOrigin
): void => {
  transactDoc(doc, () => {
    const {edges} = initializeCollections(doc);
    const edgeArray = edges.get(parentId);
    if (!edgeArray) {
      return;
    }

    const retained = edgeArray.toArray().filter((edge) => !predicate(edge));
    edgeArray.delete(0, edgeArray.length);
    if (retained.length === 0) {
      edges.delete(parentId);
      return;
    }

    edgeArray.insert(0, retained);
  }, origin);
};

export const upsertSessionState = (
  doc: Y.Doc,
  session: SessionState,
  origin?: MutationOrigin
): void => {
  transactDoc(doc, () => {
    const {sessions} = initializeCollections(doc);
    sessions.set(session.id, session);
  }, origin);
};

export const removeSessionState = (doc: Y.Doc, sessionId: SessionId, origin?: MutationOrigin): void => {
  transactDoc(doc, () => {
    const {sessions} = initializeCollections(doc);
    sessions.delete(sessionId);
  }, origin);
};

export const createResolverFromDoc = (doc: Y.Doc) => {
  const {edges} = initializeCollections(doc);
  const map = new Map<NodeId, readonly EdgeRecord[]>();
  edges.forEach((value, key) => {
    const parentId: NodeId = key;
    map.set(parentId, value.toArray());
  });
  return createChildResolverFromMap(map);
};
