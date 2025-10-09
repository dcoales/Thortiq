/**
 * Transactions and document scaffolding utilities. These helpers centralise creation of the
 * collaborative outline Y.Doc instance and ensure all mutating operations run inside
 * transactions so UndoManager bookkeeping stays consistent across adapters.
 */
import * as Y from "yjs";

import type { EdgeId } from "../ids";
import type {
  OutlineDoc,
  OutlineEdgeRecord,
  OutlineNodeRecord,
  ChildEdgeStore,
  EdgeStore,
  NodeStore,
  RootEdgeList,
  TagRegistryStore
} from "../types";
import {
  CHILD_EDGE_MAP_KEY,
  EDGES_COLLECTION_KEY,
  NODES_COLLECTION_KEY,
  ROOT_EDGES_KEY,
  TAG_REGISTRY_KEY
} from "./constants";

export class OutlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutlineError";
  }
}

export interface CreateOutlineDocResult extends OutlineDoc {}

export const createOutlineDoc = (): CreateOutlineDocResult => {
  const doc = new Y.Doc();
  const nodes = doc.getMap<OutlineNodeRecord>(NODES_COLLECTION_KEY) as NodeStore;
  const edges = doc.getMap<OutlineEdgeRecord>(EDGES_COLLECTION_KEY) as EdgeStore;
  const rootEdges = doc.getArray<EdgeId>(ROOT_EDGES_KEY) as RootEdgeList;
  const childEdgeMap = doc.getMap<Y.Array<EdgeId>>(CHILD_EDGE_MAP_KEY) as ChildEdgeStore;
  const tagRegistry = doc.getMap(TAG_REGISTRY_KEY) as TagRegistryStore;

  return { doc, nodes, edges, rootEdges, childEdgeMap, tagRegistry };
};

export const outlineFromDoc = (doc: Y.Doc): OutlineDoc => {
  const nodes = doc.getMap<OutlineNodeRecord>(NODES_COLLECTION_KEY) as NodeStore;
  const edges = doc.getMap<OutlineEdgeRecord>(EDGES_COLLECTION_KEY) as EdgeStore;
  const rootEdges = doc.getArray<EdgeId>(ROOT_EDGES_KEY) as RootEdgeList;
  const childEdgeMap = doc.getMap<Y.Array<EdgeId>>(CHILD_EDGE_MAP_KEY) as ChildEdgeStore;
  const tagRegistry = doc.getMap(TAG_REGISTRY_KEY) as TagRegistryStore;

  return { doc, nodes, edges, rootEdges, childEdgeMap, tagRegistry };
};

export const withTransaction = <T>(
  outline: OutlineDoc,
  fn: (transaction: Y.Transaction) => T,
  origin?: unknown
): T => {
  return outline.doc.transact((transaction) => fn(transaction), origin);
};
