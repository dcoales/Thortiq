import * as Y from 'yjs';

import type {EdgeId, EdgeRecord, NodeId} from '../types';
import {initializeCollections} from '../yjs/doc';
import {SELECTION_ORIGIN} from '../yjs/undo';

interface VisibleEdge {
  readonly edge: EdgeRecord;
  readonly depth: number;
  readonly parentEdgeId: EdgeId | null;
}

export interface SelectionSnapshot {
  readonly anchorEdgeId: EdgeId | null;
  readonly focusEdgeId: EdgeId | null;
  readonly selectedEdgeIds: readonly EdgeId[];
}

export class SelectionManager {
  private readonly doc: Y.Doc;

  constructor(doc: Y.Doc) {
    this.doc = doc;
  }

  selectSingle(rootId: NodeId, edgeId: EdgeId): SelectionSnapshot {
    if (!this.edgeExists(edgeId)) {
      return this.getSelectionSnapshot();
    }
    return this.applySelection(rootId, new Set<EdgeId>([edgeId]), edgeId, edgeId);
  }

  toggleEdge(rootId: NodeId, edgeId: EdgeId): SelectionSnapshot {
    const current = this.getSelectionSnapshot();
    const next = new Set<EdgeId>(current.selectedEdgeIds);
    if (next.has(edgeId)) {
      next.delete(edgeId);
    } else {
      next.add(edgeId);
    }

    const anchor = next.size > 0 ? current.anchorEdgeId ?? edgeId : null;
    const focus = next.size > 0 ? edgeId : null;

    return this.applySelection(rootId, next, anchor, focus);
  }

  selectRange(rootId: NodeId, anchorEdgeId: EdgeId, focusEdgeId: EdgeId): SelectionSnapshot {
    const visibleEdges = this.buildVisibleEdges(rootId);
    const order = new Map<EdgeId, number>();
    visibleEdges.forEach((item, index) => {
      order.set(item.edge.id, index);
    });

    if (!order.has(anchorEdgeId) || !order.has(focusEdgeId)) {
      return this.getSelectionSnapshot();
    }

    const start = order.get(anchorEdgeId) as number;
    const end = order.get(focusEdgeId) as number;
    const [from, to] = start <= end ? [start, end] : [end, start];

    const selected = new Set<EdgeId>();
    for (let index = from; index <= to; index += 1) {
      const edgeId = visibleEdges[index]?.edge.id;
      if (edgeId) {
        selected.add(edgeId);
      }
    }

    return this.applySelection(rootId, selected, anchorEdgeId, focusEdgeId);
  }

  clearSelection(): SelectionSnapshot {
    return this.applySelection(null, new Set<EdgeId>(), null, null);
  }

  moveFocus(rootId: NodeId, originEdgeId: EdgeId | null, direction: 'next' | 'previous'): SelectionSnapshot {
    const visibleEdges = this.buildVisibleEdges(rootId);
    if (visibleEdges.length === 0) {
      return this.clearSelection();
    }

    const order = new Map<EdgeId, number>();
    visibleEdges.forEach((item, index) => {
      order.set(item.edge.id, index);
    });

    let currentIndex: number;
    if (originEdgeId && order.has(originEdgeId)) {
      currentIndex = order.get(originEdgeId) as number;
    } else {
      currentIndex = direction === 'next' ? -1 : visibleEdges.length;
    }

    const nextIndex = direction === 'next'
      ? Math.min(currentIndex + 1, visibleEdges.length - 1)
      : Math.max(currentIndex - 1, 0);

    const nextEdgeId = visibleEdges[nextIndex].edge.id;
    return this.selectSingle(rootId, nextEdgeId);
  }

  getSelectionSnapshot(): SelectionSnapshot {
    const {selectionMeta} = initializeCollections(this.doc);
    const anchor = (selectionMeta.get('anchorEdgeId') as EdgeId | null) ?? null;
    const focus = (selectionMeta.get('focusEdgeId') as EdgeId | null) ?? null;
    const selectedIds = this.readSelectedIds(selectionMeta);

    return {
      anchorEdgeId: anchor,
      focusEdgeId: focus,
      selectedEdgeIds: selectedIds
    };
  }

  private edgeExists(edgeId: EdgeId): boolean {
    const {edges} = initializeCollections(this.doc);
    let found = false;
    edges.forEach((edgeArray) => {
      if (found) {
        return;
      }
      edgeArray.forEach((edge) => {
        if (edge.id === edgeId) {
          found = true;
        }
      });
    });
    return found;
  }

  private applySelection(
    rootId: NodeId | null,
    selected: Set<EdgeId>,
    anchorEdgeId: EdgeId | null,
    focusEdgeId: EdgeId | null
  ): SelectionSnapshot {
    const selectedIds = Array.from(selected);
    const timestamp = new Date().toISOString();

    this.doc.transact(() => {
      const {selectionMeta} = initializeCollections(this.doc);

      selectionMeta.set('anchorEdgeId', anchorEdgeId ?? null);
      selectionMeta.set('focusEdgeId', focusEdgeId ?? null);
      selectionMeta.set('lastChangedAt', timestamp);
      selectionMeta.set('selectedIds', JSON.stringify(selectedIds));
      if (rootId) {
        selectionMeta.set('lastRootId', rootId);
      } else {
        selectionMeta.delete('lastRootId');
      }
    }, SELECTION_ORIGIN);

    return {
      anchorEdgeId,
      focusEdgeId,
      selectedEdgeIds: selectedIds
    };
  }

  private buildVisibleEdges(rootId: NodeId): VisibleEdge[] {
    const {edges} = initializeCollections(this.doc);
    const rows: VisibleEdge[] = [];
    const stack: Array<{
      nodeId: NodeId;
      depth: number;
      viaEdge: EdgeRecord | null;
      parentEdgeId: EdgeId | null;
    }> = [
      {nodeId: rootId, depth: 0, viaEdge: null, parentEdgeId: null}
    ];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      if (current.viaEdge) {
        rows.push({
          edge: current.viaEdge,
          depth: current.depth,
          parentEdgeId: current.parentEdgeId
        });
      }

      const childEdgesArray = edges.get(current.nodeId);
      if (!childEdgesArray) {
        continue;
      }

      if (current.viaEdge?.collapsed) {
        continue;
      }

      const childEdges = childEdgesArray.toArray();
      for (let index = childEdges.length - 1; index >= 0; index -= 1) {
        const childEdge = childEdges[index];
        stack.push({
          nodeId: childEdge.childId,
          depth: current.depth + 1,
          viaEdge: childEdge,
          parentEdgeId: current.viaEdge ? current.viaEdge.id : null
        });
      }
    }

    return rows;
  }

  private readSelectedIds(selectionMeta: Y.Map<string | null>): EdgeId[] {
    const raw = selectionMeta.get('selectedIds');
    if (typeof raw === 'string') {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((value): value is EdgeId => typeof value === 'string');
        }
      } catch (error) {
        // Ignore malformed payloads and fall back to inspecting edges.
      }
    }

    // Fallback to checking the edge records when legacy documents do not provide selectedIds.
    const {edges} = initializeCollections(this.doc);
    const fallback: EdgeId[] = [];
    edges.forEach((edgeArray) => {
      edgeArray.forEach((edge) => {
        if (edge.selected) {
          fallback.push(edge.id);
        }
      });
    });
    return fallback;
  }
}
