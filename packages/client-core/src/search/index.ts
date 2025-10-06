import type { EdgeId, NodeId } from "../ids";
import type { NodeSnapshot, OutlineSnapshot } from "../types";
import {
  type OutlineSearchIndexEntry,
  type OutlineSearchIndexSnapshot
} from "./types";

const NORMALISED_EMPTY_ARRAY: readonly never[] = Object.freeze([]);

const toLower = (value: string): string => value.toLocaleLowerCase();

const deriveTypes = (node: NodeSnapshot): readonly string[] => {
  const types = new Set<string>();
  types.add("node");
  const todo = node.metadata.todo;
  if (todo) {
    types.add("task");
    types.add(todo.done ? "task:done" : "task:pending");
  }
  return Array.from(types);
};

const dedupeAndNormalise = (values: ReadonlyArray<string>): readonly string[] => {
  if (values.length === 0) {
    return NORMALISED_EMPTY_ARRAY;
  }
  const seen = new Set<string>();
  values.forEach((value) => {
    if (value && typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        seen.add(trimmed);
      }
    }
  });
  if (seen.size === 0) {
    return NORMALISED_EMPTY_ARRAY;
  }
  return Array.from(seen);
};

const lowerCaseArray = (values: ReadonlyArray<string>): readonly string[] => {
  if (values.length === 0) {
    return NORMALISED_EMPTY_ARRAY;
  }
  return values.map(toLower);
};

const buildEntry = (
  edgeId: EdgeId,
  node: NodeSnapshot,
  ancestorEdgeIds: readonly EdgeId[],
  ancestorNodeIds: readonly NodeId[]
): OutlineSearchIndexEntry => {
  const tags = dedupeAndNormalise(node.metadata.tags ?? NORMALISED_EMPTY_ARRAY);
  const tagsLower = lowerCaseArray(tags);
  return {
    edgeId,
    nodeId: node.id,
    ancestorEdgeIds,
    ancestorNodeIds,
    createdAt: node.metadata.createdAt,
    updatedAt: node.metadata.updatedAt,
    text: node.text,
    textLower: toLower(node.text ?? ""),
    tags,
    tagsLower,
    types: deriveTypes(node)
  } satisfies OutlineSearchIndexEntry;
};

export class OutlineSearchIndex {
  private readonly entries = new Map<EdgeId, OutlineSearchIndexEntry>();
  private readonly nodeToEdgeIds = new Map<NodeId, EdgeId[]>();
  private version = 0;

  static fromSnapshot(snapshot: OutlineSnapshot): OutlineSearchIndex {
    const index = new OutlineSearchIndex();
    index.rebuild(snapshot);
    return index;
  }

  getVersion(): number {
    return this.version;
  }

  getEntries(): ReadonlyMap<EdgeId, OutlineSearchIndexEntry> {
    return this.entries;
  }

  getNodeEdgeIds(nodeId: NodeId): readonly EdgeId[] {
    const list = this.nodeToEdgeIds.get(nodeId);
    if (!list || list.length === 0) {
      return NORMALISED_EMPTY_ARRAY;
    }
    return list;
  }

  rebuild(snapshot: OutlineSnapshot): void {
    this.entries.clear();
    this.nodeToEdgeIds.clear();
    const visit = (
      edgeId: EdgeId,
      ancestorEdgeIds: EdgeId[],
      ancestorNodeIds: NodeId[]
    ) => {
      const edge = snapshot.edges.get(edgeId);
      if (!edge) {
        return;
      }
      const node = snapshot.nodes.get(edge.childNodeId);
      if (!node) {
        return;
      }

      const pathEdges = [...ancestorEdgeIds, edgeId];
      const pathNodes = [...ancestorNodeIds, node.id];
      const entry = buildEntry(edgeId, node, ancestorEdgeIds.slice(), ancestorNodeIds.slice());
      this.entries.set(edgeId, entry);
      const nodeEdges = this.nodeToEdgeIds.get(node.id) ?? [];
      nodeEdges.push(edgeId);
      this.nodeToEdgeIds.set(node.id, nodeEdges);
      const childEdgeIds = snapshot.childrenByParent.get(node.id) ?? NORMALISED_EMPTY_ARRAY;
      childEdgeIds.forEach((childEdgeId) => visit(childEdgeId, pathEdges, pathNodes));
    };

    snapshot.rootEdgeIds.forEach((edgeId) => visit(edgeId, [], []));

    this.version += 1;
  }

  updateNode(nodeId: NodeId, nodeSnapshot: NodeSnapshot): void {
    const edgeIds = this.nodeToEdgeIds.get(nodeId);
    if (!edgeIds || edgeIds.length === 0) {
      return;
    }
    const snapshotTags = dedupeAndNormalise(nodeSnapshot.metadata.tags ?? NORMALISED_EMPTY_ARRAY);
    const tagsLower = lowerCaseArray(snapshotTags);
    const types = deriveTypes(nodeSnapshot);
    const nextTextLower = toLower(nodeSnapshot.text ?? "");
    const nextCreated = nodeSnapshot.metadata.createdAt;
    const nextUpdated = nodeSnapshot.metadata.updatedAt;
    let changed = false;
    edgeIds.forEach((edgeId) => {
      const existing = this.entries.get(edgeId);
      if (!existing) {
        return;
      }
      if (
        existing.text === nodeSnapshot.text
        && existing.textLower === nextTextLower
        && existing.createdAt === nextCreated
        && existing.updatedAt === nextUpdated
        && existing.tags.length === snapshotTags.length
        && existing.tags.every((tag, index) => tag === snapshotTags[index])
        && existing.tagsLower.length === tagsLower.length
        && existing.tagsLower.every((tag, index) => tag === tagsLower[index])
        && existing.types.length === types.length
        && existing.types.every((type, index) => type === types[index])
      ) {
        return;
      }
      changed = true;
      this.entries.set(edgeId, {
        ...existing,
        text: nodeSnapshot.text,
        textLower: nextTextLower,
        tags: snapshotTags,
        tagsLower,
        types,
        createdAt: nextCreated,
        updatedAt: nextUpdated
      });
    });
    if (changed) {
      this.version += 1;
    }
  }

  removeEdge(edgeId: EdgeId): void {
    const entry = this.entries.get(edgeId);
    if (!entry) {
      return;
    }
    this.entries.delete(edgeId);
    const list = this.nodeToEdgeIds.get(entry.nodeId);
    if (list) {
      const next = list.filter((candidate) => candidate !== edgeId);
      if (next.length === 0) {
        this.nodeToEdgeIds.delete(entry.nodeId);
      } else {
        this.nodeToEdgeIds.set(entry.nodeId, next);
      }
    }
    this.version += 1;
  }

  getSnapshot(): OutlineSearchIndexSnapshot {
    const entriesSnapshot = new Map<EdgeId, OutlineSearchIndexEntry>(this.entries);
    const nodeEdgeSnapshot = new Map<NodeId, readonly EdgeId[]>();
    this.nodeToEdgeIds.forEach((edgeIds, nodeId) => {
      nodeEdgeSnapshot.set(nodeId, edgeIds.slice());
    });
    return {
      entries: entriesSnapshot,
      nodeToEdgeIds: nodeEdgeSnapshot
    } satisfies OutlineSearchIndexSnapshot;
  }
}
