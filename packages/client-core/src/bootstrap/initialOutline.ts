/**
 * Provides an idempotent seeding routine for brand-new outline documents.
 * The helper guarantees a canonical root (DOCUMENT_ROOT_ID) and inserts
 * shared default children exactly once so every platform boots with
 * consistent starter content.
 */
import type {Doc as YDoc} from 'yjs';

import type {NodeId, NodeRecord} from '../types';
import {createEdgeId, createNodeId} from '../ids';
import {ensureDocumentRoot, initializeCollections, insertEdgeRecord, upsertNodeRecord} from '../yjs/doc';

const DEFAULT_SEED_TITLES = ['Root node', 'Planning session', 'Daily notes', 'Ideas'] as const;

export interface OutlineBootstrapOptions {
  readonly seedTitles?: readonly string[];
  readonly now?: () => string;
}

export interface OutlineBootstrapResult {
  readonly root: NodeRecord;
  readonly seededNodeIds: readonly NodeId[];
}

export const bootstrapInitialOutline = (
  doc: YDoc,
  options: OutlineBootstrapOptions = {}
): OutlineBootstrapResult => {
  const {seedTitles = DEFAULT_SEED_TITLES, now = () => new Date().toISOString()} = options;
  const root = ensureDocumentRoot(doc);
  const {edges} = initializeCollections(doc);

  if (edges.get(root.id)?.length) {
    return {root, seededNodeIds: []};
  }

  const timestamp = now();
  const seededNodeIds: NodeId[] = [];

  seedTitles.forEach((title, index) => {
    const nodeId = createNodeId();
    seededNodeIds.push(nodeId);

    upsertNodeRecord(doc, {
      id: nodeId,
      html: title,
      tags: [],
      attributes: {},
      createdAt: timestamp,
      updatedAt: timestamp
    });

    insertEdgeRecord(doc, {
      id: createEdgeId(),
      parentId: root.id,
      childId: nodeId,
      role: 'primary',
      collapsed: false,
      ordinal: index,
      selected: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  });

  return {root, seededNodeIds};
};

export const getDefaultSeedTitles = (): readonly string[] => DEFAULT_SEED_TITLES;
