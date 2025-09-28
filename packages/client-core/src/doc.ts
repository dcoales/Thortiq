/**
 * Yjs-backed data model helpers for the collaborative outline. This module owns creation of
 * the shared document, mutation helpers that always transact, and structural invariants like
 * cycle prevention and edge-local state. Consumers should never mutate Yjs structures
 * directly; always go through these helpers to honour AGENTS.md rules.
 */
import * as Y from "yjs";

import { createEdgeId, createNodeId, type EdgeId, type NodeId } from "./ids";
import type {
  AddEdgeOptions,
  CreateNodeOptions,
  EdgeSnapshot,
  NodeMetadata,
  NodeSnapshot,
  OutlineDoc,
  OutlineEdgeRecord,
  OutlineNodeRecord,
  OutlineSnapshot
} from "./types";

const NODES_COLLECTION_KEY = "nodes";
const EDGES_COLLECTION_KEY = "edges";
const ROOT_EDGES_KEY = "rootEdges";
const CHILD_EDGE_MAP_KEY = "childEdgeMap";

const NODE_TEXT_KEY = "text";
const NODE_METADATA_KEY = "metadata";

const EDGE_PARENT_NODE_KEY = "parentNodeId";
const EDGE_CHILD_NODE_KEY = "childNodeId";
const EDGE_COLLAPSED_KEY = "collapsed";
const EDGE_MIRROR_KEY = "mirrorOfNodeId";
const EDGE_POSITION_KEY = "position";

export class OutlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutlineError";
  }
}

export interface CreateOutlineDocResult extends OutlineDoc {}

export const createOutlineDoc = (): CreateOutlineDocResult => {
  const doc = new Y.Doc();
  const nodes = doc.getMap<OutlineNodeRecord>(NODES_COLLECTION_KEY);
  const edges = doc.getMap<OutlineEdgeRecord>(EDGES_COLLECTION_KEY);
  const rootEdges = doc.getArray<EdgeId>(ROOT_EDGES_KEY);
  const childEdgeMap = doc.getMap<Y.Array<EdgeId>>(CHILD_EDGE_MAP_KEY);

  return { doc, nodes, edges, rootEdges, childEdgeMap };
};

export const outlineFromDoc = (doc: Y.Doc): OutlineDoc => {
  const nodes = doc.getMap<OutlineNodeRecord>(NODES_COLLECTION_KEY);
  const edges = doc.getMap<OutlineEdgeRecord>(EDGES_COLLECTION_KEY);
  const rootEdges = doc.getArray<EdgeId>(ROOT_EDGES_KEY);
  const childEdgeMap = doc.getMap<Y.Array<EdgeId>>(CHILD_EDGE_MAP_KEY);

  return { doc, nodes, edges, rootEdges, childEdgeMap };
};

export const withTransaction = <T>(outline: OutlineDoc, fn: () => T, origin?: unknown): T => {
  return outline.doc.transact(fn, origin);
};

export const createNode = (outline: OutlineDoc, options: CreateNodeOptions = {}): NodeId => {
  const nodeId = options.id ?? createNodeId();

  withTransaction(
    outline,
    () => {
      if (outline.nodes.has(nodeId)) {
        throw new OutlineError(`Node ${nodeId} already exists`);
      }

      const nodeRecord = new Y.Map<unknown>();
      const text = new Y.Text(options.text ?? "");
      nodeRecord.set(NODE_TEXT_KEY, text);

      const metadata = createMetadataMap(options.metadata);
      nodeRecord.set(NODE_METADATA_KEY, metadata);

      outline.nodes.set(nodeId, nodeRecord);
    },
    options.origin
  );

  return nodeId;
};

export const nodeExists = (outline: OutlineDoc, nodeId: NodeId): boolean => outline.nodes.has(nodeId);

export const edgeExists = (outline: OutlineDoc, edgeId: EdgeId): boolean => outline.edges.has(edgeId);

export const getNodeText = (outline: OutlineDoc, nodeId: NodeId): string => {
  const text = getNodeTextY(outline, nodeId);
  return text.toString();
};

export const setNodeText = (
  outline: OutlineDoc,
  nodeId: NodeId,
  textValue: string,
  origin?: unknown
): void => {
  withTransaction(outline, () => {
    const text = getNodeTextY(outline, nodeId);
    text.delete(0, text.length);
    if (textValue.length > 0) {
      text.insert(0, textValue);
    }

    const metadata = getNodeMetadataMap(outline, nodeId);
    metadata.set("updatedAt", Date.now());
  }, origin);
};

export const getNodeMetadata = (outline: OutlineDoc, nodeId: NodeId): NodeMetadata => {
  const metadata = getNodeMetadataMap(outline, nodeId);
  return readMetadata(metadata);
};

export const updateNodeMetadata = (
  outline: OutlineDoc,
  nodeId: NodeId,
  patch: Partial<NodeMetadata>,
  origin?: unknown
): void => {
  withTransaction(outline, () => {
    const metadataMap = getNodeMetadataMap(outline, nodeId);
    applyMetadataPatch(metadataMap, patch);
  }, origin);
};

export const addEdge = (
  outline: OutlineDoc,
  options: AddEdgeOptions
): { edgeId: EdgeId; nodeId: NodeId } => {
  if (options.parentNodeId !== null && !nodeExists(outline, options.parentNodeId)) {
    throw new OutlineError(`Parent node ${options.parentNodeId} does not exist`);
  }

  let childNodeId = options.childNodeId;

  if (!childNodeId) {
    childNodeId = createNode(outline, {
      text: options.text,
      metadata: options.metadata,
      origin: options.origin
    });
  } else if (!nodeExists(outline, childNodeId)) {
    // When a caller supplies an explicit child ID we assume they created the node via createNode.
    throw new OutlineError(`Child node ${childNodeId} does not exist`);
  }

  if (options.parentNodeId && childNodeId) {
    assertNoCycle(outline, options.parentNodeId, childNodeId);
  }

  const edgeId = createEdgeId();

  withTransaction(outline, () => {
    const record = new Y.Map<unknown>();
    record.set(EDGE_PARENT_NODE_KEY, options.parentNodeId);
    record.set(EDGE_CHILD_NODE_KEY, childNodeId);
    record.set(EDGE_COLLAPSED_KEY, options.collapsed ?? false);
    record.set(EDGE_MIRROR_KEY, options.mirrorOfNodeId ?? null);
    record.set(EDGE_POSITION_KEY, 0);

    outline.edges.set(edgeId, record);

    const targetArray = getEdgeArrayForParent(outline, options.parentNodeId);
    const insertIndex = resolveInsertIndex(targetArray, options.position);
    targetArray.insert(insertIndex, [edgeId]);

    updatePositionsForParent(outline, options.parentNodeId);
  }, options.origin);

  return { edgeId, nodeId: childNodeId! };
};

export const getEdgeSnapshot = (outline: OutlineDoc, edgeId: EdgeId): EdgeSnapshot => {
  const record = outline.edges.get(edgeId);
  if (!record) {
    throw new OutlineError(`Edge ${edgeId} not found`);
  }

  return readEdgeSnapshot(edgeId, record);
};

export const getNodeSnapshot = (outline: OutlineDoc, nodeId: NodeId): NodeSnapshot => {
  const record = outline.nodes.get(nodeId);
  if (!record) {
    throw new OutlineError(`Node ${nodeId} not found`);
  }

  return readNodeSnapshot(nodeId, record);
};

export const getChildEdgeIds = (outline: OutlineDoc, parentNodeId: NodeId): ReadonlyArray<EdgeId> => {
  const array = outline.childEdgeMap.get(parentNodeId);
  return array ? array.toArray() : ([] as EdgeId[]);
};

export const getRootEdgeIds = (outline: OutlineDoc): ReadonlyArray<EdgeId> => {
  return outline.rootEdges.toArray();
};

const getNodeRecord = (outline: OutlineDoc, nodeId: NodeId): OutlineNodeRecord => {
  const record = outline.nodes.get(nodeId);
  if (!record) {
    throw new OutlineError(`Node ${nodeId} not found`);
  }
  return record;
};

const getNodeTextY = (outline: OutlineDoc, nodeId: NodeId): Y.Text => {
  const record = getNodeRecord(outline, nodeId);
  const text = record.get(NODE_TEXT_KEY);
  if (!(text instanceof Y.Text)) {
    throw new OutlineError(`Node ${nodeId} has no text field`);
  }
  return text;
};

const getNodeMetadataMap = (outline: OutlineDoc, nodeId: NodeId): Y.Map<unknown> => {
  const record = getNodeRecord(outline, nodeId);
  const metadata = record.get(NODE_METADATA_KEY);
  if (!(metadata instanceof Y.Map)) {
    throw new OutlineError(`Node ${nodeId} has no metadata map`);
  }
  return metadata as Y.Map<unknown>;
};

const createMetadataMap = (metadata?: Partial<NodeMetadata>): Y.Map<unknown> => {
  const map = new Y.Map<unknown>();
  const createdAt = metadata?.createdAt ?? Date.now();
  map.set("createdAt", createdAt);
  map.set("updatedAt", metadata?.updatedAt ?? createdAt);

  const tagsArray = new Y.Array<string>();
  const tags = metadata?.tags ?? [];
  if (tags.length > 0) {
    tagsArray.push([...tags]);
  }
  map.set("tags", tagsArray);

  if (metadata?.todo) {
    map.set("todo", createTodoMap(metadata.todo));
  }

  if (metadata?.color) {
    map.set("color", metadata.color);
  }

  if (metadata?.backgroundColor) {
    map.set("backgroundColor", metadata.backgroundColor);
  }

  return map;
};

const createTodoMap = (todo: NonNullable<NodeMetadata["todo"]>): Y.Map<unknown> => {
  const todoMap = new Y.Map<unknown>();
  todoMap.set("done", todo.done);
  if (todo.dueDate) {
    todoMap.set("dueDate", todo.dueDate);
  }
  return todoMap;
};

const readMetadata = (metadata: Y.Map<unknown>): NodeMetadata => {
  const createdAt = metadata.get("createdAt");
  const updatedAt = metadata.get("updatedAt");
  const tagsArray = metadata.get("tags");
  const todo = metadata.get("todo");

  return {
    createdAt: typeof createdAt === "number" ? createdAt : 0,
    updatedAt: typeof updatedAt === "number" ? updatedAt : 0,
    tags: tagsArray instanceof Y.Array ? tagsArray.toArray() : [],
    todo: todo instanceof Y.Map ? readTodoMetadata(todo) : undefined,
    color: typeof metadata.get("color") === "string" ? (metadata.get("color") as string) : undefined,
    backgroundColor:
      typeof metadata.get("backgroundColor") === "string"
        ? (metadata.get("backgroundColor") as string)
        : undefined
  };
};

const readTodoMetadata = (todoMap: Y.Map<unknown>): NonNullable<NodeMetadata["todo"]> => {
  const done = Boolean(todoMap.get("done"));
  const dueDate = todoMap.get("dueDate");
  return { done, dueDate: typeof dueDate === "string" ? dueDate : undefined };
};

const applyMetadataPatch = (metadataMap: Y.Map<unknown>, patch: Partial<NodeMetadata>): void => {
  const now = Date.now();
  if (patch.tags) {
    const tagsArray = ensureTagsArray(metadataMap);
    tagsArray.delete(0, tagsArray.length);
    if (patch.tags.length > 0) {
      tagsArray.push(Array.from(patch.tags));
    }
  }

  if (patch.todo) {
    const todo = metadataMap.get("todo");
    if (todo instanceof Y.Map) {
      todo.set("done", patch.todo.done);
      if (patch.todo.dueDate) {
        todo.set("dueDate", patch.todo.dueDate);
      } else {
        todo.delete("dueDate");
      }
    } else {
      metadataMap.set("todo", createTodoMap(patch.todo));
    }
  } else if (hasOwnProperty(patch, "todo")) {
    metadataMap.delete("todo");
  }

  if (hasOwnProperty(patch, "color")) {
    if (patch.color == null) {
      metadataMap.delete("color");
    } else {
      metadataMap.set("color", patch.color);
    }
  }

  if (hasOwnProperty(patch, "backgroundColor")) {
    if (patch.backgroundColor == null) {
      metadataMap.delete("backgroundColor");
    } else {
      metadataMap.set("backgroundColor", patch.backgroundColor);
    }
  }

  metadataMap.set("updatedAt", patch.updatedAt ?? now);
};

const ensureTagsArray = (metadataMap: Y.Map<unknown>): Y.Array<string> => {
  const tags = metadataMap.get("tags");
  if (tags instanceof Y.Array) {
    return tags as Y.Array<string>;
  }
  const newArray = new Y.Array<string>();
  metadataMap.set("tags", newArray);
  return newArray;
};

const hasOwnProperty = (value: object, key: string): boolean => {
  return Object.prototype.hasOwnProperty.call(value, key);
};

const getEdgeArrayForParent = (outline: OutlineDoc, parentNodeId: NodeId | null): Y.Array<EdgeId> => {
  if (parentNodeId === null) {
    return outline.rootEdges;
  }

  let array = outline.childEdgeMap.get(parentNodeId);
  if (!array) {
    array = new Y.Array<EdgeId>();
    outline.childEdgeMap.set(parentNodeId, array);
  }
  return array;
};

const resolveInsertIndex = (target: Y.Array<EdgeId>, position?: number): number => {
  if (position === undefined || Number.isNaN(position)) {
    return target.length;
  }
  if (position < 0) {
    return 0;
  }
  if (position > target.length) {
    return target.length;
  }
  return position;
};

const updatePositionsForParent = (outline: OutlineDoc, parentNodeId: NodeId | null): void => {
  const target = getEdgeArrayForParent(outline, parentNodeId);
  target.toArray().forEach((edgeId, index) => {
    const record = outline.edges.get(edgeId);
    if (record instanceof Y.Map) {
      record.set(EDGE_POSITION_KEY, index);
    }
  });
};

const assertNoCycle = (outline: OutlineDoc, parentNodeId: NodeId, childNodeId: NodeId): void => {
  if (parentNodeId === childNodeId) {
    throw new OutlineError("Cannot make a node a child of itself");
  }

  const visited = new Set<NodeId>();
  const queue: NodeId[] = [childNodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === parentNodeId) {
      throw new OutlineError("Operation would create a cycle in the outline");
    }

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const childEdges = outline.childEdgeMap.get(current);
    if (!childEdges) {
      continue;
    }

    childEdges.toArray().forEach((edgeId) => {
      const record = outline.edges.get(edgeId);
      if (record instanceof Y.Map) {
        const descendant = record.get(EDGE_CHILD_NODE_KEY);
        if (typeof descendant === "string") {
          queue.push(descendant as NodeId);
        }
      }
    });
  }
};

const readNodeSnapshot = (nodeId: NodeId, record: OutlineNodeRecord): NodeSnapshot => {
  const text = record.get(NODE_TEXT_KEY);
  const metadata = record.get(NODE_METADATA_KEY);

  const resolvedText = text instanceof Y.Text ? text.toString() : "";
  const resolvedMetadata = metadata instanceof Y.Map ? readMetadata(metadata) : createEmptyMetadata();

  return {
    id: nodeId,
    text: resolvedText,
    metadata: resolvedMetadata
  };
};

export const readEdgeSnapshot = (edgeId: EdgeId, record: OutlineEdgeRecord): EdgeSnapshot => {
  const parentNodeId = record.get(EDGE_PARENT_NODE_KEY);
  const childNodeId = record.get(EDGE_CHILD_NODE_KEY);
  const collapsed = record.get(EDGE_COLLAPSED_KEY);
  const mirrorNodeId = record.get(EDGE_MIRROR_KEY);
  const position = record.get(EDGE_POSITION_KEY);

  return {
    id: edgeId,
    parentNodeId: typeof parentNodeId === "string" ? (parentNodeId as NodeId) : null,
    childNodeId: typeof childNodeId === "string" ? (childNodeId as NodeId) : ("" as NodeId),
    collapsed: Boolean(collapsed),
    mirrorOfNodeId: typeof mirrorNodeId === "string" ? (mirrorNodeId as NodeId) : null,
    position: typeof position === "number" ? position : 0
  };
};

const createEmptyMetadata = (): NodeMetadata => ({
  createdAt: 0,
  updatedAt: 0,
  tags: []
});

export const createOutlineSnapshot = (outline: OutlineDoc): OutlineSnapshot => {
  const nodeEntries = new Map<NodeId, NodeSnapshot>();
  outline.nodes.forEach((record, id) => {
    nodeEntries.set(id as NodeId, readNodeSnapshot(id as NodeId, record));
  });

  const edgeEntries = new Map<EdgeId, EdgeSnapshot>();
  outline.edges.forEach((record, id) => {
    edgeEntries.set(id as EdgeId, readEdgeSnapshot(id as EdgeId, record));
  });

  const childrenByParent = new Map<NodeId, ReadonlyArray<EdgeId>>();
  outline.childEdgeMap.forEach((array, parentId) => {
    const snapshotArray = Object.freeze(array.toArray()) as ReadonlyArray<EdgeId>;
    childrenByParent.set(parentId as NodeId, snapshotArray);
  });

  const snapshot: OutlineSnapshot = {
    nodes: nodeEntries as ReadonlyMap<NodeId, NodeSnapshot>,
    edges: edgeEntries as ReadonlyMap<EdgeId, EdgeSnapshot>,
    rootEdgeIds: Object.freeze(outline.rootEdges.toArray()) as ReadonlyArray<EdgeId>,
    childrenByParent: childrenByParent as ReadonlyMap<NodeId, ReadonlyArray<EdgeId>>
  };

  return snapshot;
};
