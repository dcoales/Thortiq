import * as Y from 'yjs';
import type {PluginKey} from 'prosemirror-state';

import {createChildResolverFromMap, wouldCreateCycle} from '../invariants';
import type {
  EdgeRecord,
  NodeId,
  NodeRecord,
  SessionId,
  SessionState
} from '../types';
import {htmlToPlainText} from '../utils/text';
import {htmlToRichTextDoc} from '../richtext/serializers';
import {prosemirrorToYXmlFragment} from 'y-prosemirror';
import {
  EDGES_COLLECTION,
  DOCUMENT_ROOT_ID,
  NODES_COLLECTION,
  NODE_TEXTS_COLLECTION,
  NODE_RICH_TEXT_COLLECTION,
  SESSIONS_COLLECTION,
  SELECTION_META_COLLECTION
} from './constants';

export type MutationOrigin = string | symbol | {readonly source: string} | PluginKey<unknown>;

export interface ThortiqDocCollections {
  readonly nodes: Y.Map<NodeRecord>;
  readonly edges: Y.Map<Y.Array<EdgeRecord>>;
  readonly sessions: Y.Map<SessionState>;
  readonly nodeTexts: Y.Map<Y.Text>;
  readonly nodeRichText: Y.Map<Y.XmlFragment>;
  readonly selectionMeta: Y.Map<string | null>;
}

export const initializeCollections = (doc: Y.Doc): ThortiqDocCollections => {
  const nodes = doc.getMap<NodeRecord>(NODES_COLLECTION);
  const edges = doc.getMap<Y.Array<EdgeRecord>>(EDGES_COLLECTION);
  const sessions = doc.getMap<SessionState>(SESSIONS_COLLECTION);
  const nodeTexts = doc.getMap<Y.Text>(NODE_TEXTS_COLLECTION);
  const nodeRichText = doc.getMap<Y.XmlFragment>(NODE_RICH_TEXT_COLLECTION);
  const selectionMeta = doc.getMap<string | null>(SELECTION_META_COLLECTION);
  return {nodes, edges, sessions, nodeTexts, nodeRichText, selectionMeta};
};

const updateFragmentFromHtml = (fragment: Y.XmlFragment, html: string) => {
  fragment.delete(0, fragment.length);
  const docNode = htmlToRichTextDoc(html);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  prosemirrorToYXmlFragment(docNode, fragment);
};

export const ensureDocumentRoot = (doc: Y.Doc): NodeRecord => {
  const {nodes, nodeTexts, nodeRichText} = initializeCollections(doc);
  const existing = nodes.get(DOCUMENT_ROOT_ID);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const record: NodeRecord = {
    id: DOCUMENT_ROOT_ID,
    html: '',
    tags: [],
    attributes: {},
    createdAt: now,
    updatedAt: now
  };

  doc.transact(() => {
    nodes.set(DOCUMENT_ROOT_ID, record);
    if (!nodeTexts.get(DOCUMENT_ROOT_ID)) {
      nodeTexts.set(DOCUMENT_ROOT_ID, new Y.Text());
    }
    if (!nodeRichText.get(DOCUMENT_ROOT_ID)) {
      const fragment = new Y.XmlFragment();
      updateFragmentFromHtml(fragment, '');
      nodeRichText.set(DOCUMENT_ROOT_ID, fragment);
    }
  });
  return record;
};

export const createThortiqDoc = (): Y.Doc => {
  const doc = new Y.Doc();
  initializeCollections(doc);
  ensureDocumentRoot(doc);
  return doc;
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
    const {nodes, nodeTexts, nodeRichText} = initializeCollections(doc);
    nodes.set(node.id, node);
    ensureNodeText(nodeTexts, node.id, htmlToPlainText(node.html));
    ensureNodeRichText(nodeRichText, nodes, node.id);
  }, origin);
};

export const removeNodeRecord = (doc: Y.Doc, nodeId: NodeId, origin?: MutationOrigin): void => {
  transactDoc(doc, () => {
    const {nodes, edges, nodeTexts, nodeRichText} = initializeCollections(doc);
    nodes.delete(nodeId);
    edges.delete(nodeId);
    nodeTexts.delete(nodeId);
    nodeRichText.delete(nodeId);
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

const ensureNodeText = (
  nodeTexts: Y.Map<Y.Text>,
  nodeId: NodeId,
  initialText: string
): Y.Text => {
  const existing = nodeTexts.get(nodeId);
  if (existing) {
    return existing;
  }

  const text = new Y.Text();
  if (initialText.length > 0) {
    text.insert(0, initialText);
  }
  nodeTexts.set(nodeId, text);
  return text;
};

const ensureNodeRichText = (
  nodeRichText: Y.Map<Y.XmlFragment>,
  nodes: Y.Map<NodeRecord>,
  nodeId: NodeId
): Y.XmlFragment => {
  const existing = nodeRichText.get(nodeId);
  if (existing) {
    return existing;
  }

  const fragment = new Y.XmlFragment();
  const node = nodes.get(nodeId);
  const html = node?.html ?? '';
  updateFragmentFromHtml(fragment, html);
  nodeRichText.set(nodeId, fragment);
  return fragment;
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

export const getNodeText = (doc: Y.Doc, nodeId: NodeId): Y.Text | undefined => {
  const {nodeTexts} = initializeCollections(doc);
  return nodeTexts.get(nodeId);
};

export const getOrCreateNodeText = (doc: Y.Doc, nodeId: NodeId, initialText = ''): Y.Text => {
  const {nodeTexts} = initializeCollections(doc);
  return ensureNodeText(nodeTexts, nodeId, initialText);
};

export const getOrCreateNodeRichText = (doc: Y.Doc, nodeId: NodeId): Y.XmlFragment => {
  const {nodeRichText, nodes} = initializeCollections(doc);
  return ensureNodeRichText(nodeRichText, nodes, nodeId);
};
