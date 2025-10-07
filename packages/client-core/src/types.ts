/**
 * Shared type definitions describing the collaborative outline data-model. These runtime
 * invariants keep mirrors, edge-local state, and metadata consistent across clients.
 */
import type * as Y from "yjs";

import type { EdgeId, NodeId } from "./ids";

export interface NodeMetadata {
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly tags: ReadonlyArray<string>;
  readonly todo?: {
    readonly done: boolean;
    readonly dueDate?: string;
  };
  readonly color?: string;
  readonly backgroundColor?: string;
}

export interface EdgeState {
  readonly collapsed: boolean;
}

export interface InlineMark {
  readonly type: string;
  readonly attrs: Readonly<Record<string, unknown>>;
}

export interface InlineSpan {
  readonly text: string;
  readonly marks: ReadonlyArray<InlineMark>;
}

export interface NodeSnapshot {
  readonly id: NodeId;
  readonly text: string;
  readonly inlineContent: ReadonlyArray<InlineSpan>;
  readonly metadata: NodeMetadata;
}

export interface EdgeSnapshot {
  readonly id: EdgeId;
  readonly parentNodeId: NodeId | null;
  readonly childNodeId: NodeId;
  readonly collapsed: boolean;
  readonly mirrorOfNodeId: NodeId | null;
  readonly position: number;
}

export interface OutlineTreeNode {
  readonly edge: EdgeSnapshot;
  readonly node: NodeSnapshot;
  readonly children: ReadonlyArray<OutlineTreeNode>;
}

export interface OutlineSnapshot {
  readonly nodes: ReadonlyMap<NodeId, NodeSnapshot>;
  readonly edges: ReadonlyMap<EdgeId, EdgeSnapshot>;
  readonly rootEdgeIds: ReadonlyArray<EdgeId>;
  readonly childrenByParent: ReadonlyMap<NodeId, ReadonlyArray<EdgeId>>;
}

export interface OutlineDoc {
  readonly doc: Y.Doc;
  readonly nodes: NodeStore;
  readonly edges: EdgeStore;
  readonly rootEdges: RootEdgeList;
  readonly childEdgeMap: ChildEdgeStore;
}

export type NodeStore = Y.Map<OutlineNodeRecord>;
export type EdgeStore = Y.Map<OutlineEdgeRecord>;
export type RootEdgeList = Y.Array<EdgeId>;
export type ChildEdgeStore = Y.Map<Y.Array<EdgeId>>;
export type OutlineNodeRecord = Y.Map<unknown>;
export type OutlineEdgeRecord = Y.Map<unknown>;

export interface CreateNodeOptions {
  readonly id?: NodeId;
  readonly text?: string;
  readonly metadata?: Partial<NodeMetadata>;
  readonly origin?: unknown;
}

export interface AddEdgeOptions {
  readonly parentNodeId: NodeId | null;
  readonly childNodeId?: NodeId;
  /**
   * When provided, the new edge references an existing node rather than creating a fresh node.
   * Callers must pass the canonical source node id (never another mirror edge id) and rely on
   * {@link addEdge} to enforce cycle prevention. Downstream consumers treat `mirrorOfNodeId`
   * as a hint for UI affordances; structural operations still run against {@link childNodeId}.
   */
  readonly mirrorOfNodeId?: NodeId | null;
  readonly collapsed?: boolean;
  readonly position?: number;
  readonly text?: string;
  readonly metadata?: Partial<NodeMetadata>;
  readonly origin?: unknown;
}
