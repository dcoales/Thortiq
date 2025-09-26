/**
 * Wiki search helpers
 *
 * Provides lightweight candidate lookup over all nodes using current Yjs doc
 * state. Avoids heavy recomputation per keystroke; callers should debounce.
 */
import type * as Y from 'yjs';
import {initializeCollections} from '../yjs/doc';
import type {NodeId, NodeRecord, EdgeRecord} from '../types';
import {htmlToPlainText} from '../utils/text';

export interface WikiCandidate {
  readonly nodeId: NodeId;
  readonly label: string; // first line of text
  readonly breadcrumb: string; // path from root using primary parents when available
}

const buildParentMap = (edges: Y.Map<Y.Array<EdgeRecord>>): Map<NodeId, NodeId[]> => {
  const parents = new Map<NodeId, NodeId[]>();
  edges.forEach((arr, parentId) => {
    arr.forEach((edge) => {
      const list = parents.get(edge.childId) ?? [];
      list.push(parentId);
      parents.set(edge.childId, list);
    });
  });
  return parents;
};

const buildBreadcrumb = (
  nodes: Y.Map<NodeRecord>,
  parents: Map<NodeId, NodeId[]>,
  nodeId: NodeId,
  rootId?: NodeId
): string => {
  const seen = new Set<NodeId>();
  const labels: string[] = [];
  let current: NodeId | undefined = nodeId;
  let safety = 0;
  while (current && !seen.has(current) && safety < 1000) {
    seen.add(current);
    const node = nodes.get(current);
    if (node) {
      const text = htmlToPlainText(node.html);
      const first = text.split('\n')[0]?.trim() || 'Untitled';
      labels.push(first);
    }
    if (current === rootId) break;
    const p = parents.get(current);
    current = p && p.length > 0 ? p[0] : undefined;
    safety += 1;
  }
  return labels.reverse().join(' > ');
};

export interface FindCandidatesOptions {
  readonly doc: Y.Doc;
  readonly query: string;
  readonly rootId?: NodeId;
  readonly limit?: number;
  readonly excludeNodeIds?: ReadonlySet<NodeId>;
}

export const findWikiCandidates = ({doc, query, rootId, limit = 20, excludeNodeIds}: FindCandidatesOptions): WikiCandidate[] => {
  const {nodes, edges} = initializeCollections(doc);
  const parents = buildParentMap(edges);
  const terms = query
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);

  const matches: WikiCandidate[] = [];
  nodes.forEach((node) => {
    if (excludeNodeIds && excludeNodeIds.has(node.id)) {
      return;
    }
    const text = htmlToPlainText(node.html);
    const first = text.split('\n')[0]?.trim() || 'Untitled';
    const hay = (first + ' ' + text).toLowerCase();
    const ok = terms.every((term) => hay.includes(term));
    if (!ok) return;
    const breadcrumb = buildBreadcrumb(nodes, parents, node.id, rootId);
    matches.push({nodeId: node.id, label: first, breadcrumb});
  });

  // Prefer shorter labels and earlier created items heuristically
  matches.sort((a, b) => a.label.length - b.label.length);
  return matches.slice(0, limit);
};
