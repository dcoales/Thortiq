/**
 * Builds and maintains search indexes for efficient querying. Supports incremental
 * updates to avoid rebuilding the entire index on every change.
 */
import type { NodeId } from "../ids";
import type { OutlineSnapshot, NodeSnapshot } from "../types";
import type { SearchIndex, IndexUpdateEvent } from "./types";

/**
 * Creates a complete search index from an outline snapshot.
 */
export const createSearchIndex = (snapshot: OutlineSnapshot): SearchIndex => {
  const textIndex = new Map<string, Set<NodeId>>();
  const pathIndex = new Map<string, Set<NodeId>>();
  const tagIndex = new Map<string, Set<NodeId>>();
  const typeIndex = new Map<string, Set<NodeId>>();
  const createdIndex = new Map<number, Set<NodeId>>();
  const updatedIndex = new Map<number, Set<NodeId>>();
  
  // Build path map for efficient path indexing
  const pathMap = buildPathMap(snapshot);
  
  // Index all nodes
  snapshot.nodes.forEach((node, nodeId) => {
    indexNodeText(node, nodeId, textIndex);
    indexNodePath(nodeId, pathMap, snapshot, pathIndex);
    indexNodeMetadata(node, nodeId, tagIndex, typeIndex, createdIndex, updatedIndex);
  });
  
  return {
    textIndex: freezeMap(textIndex),
    pathIndex: freezeMap(pathIndex),
    tagIndex: freezeMap(tagIndex),
    typeIndex: freezeMap(typeIndex),
    createdIndex: freezeMap(createdIndex),
    updatedIndex: freezeMap(updatedIndex),
    version: Date.now()
  };
};

/**
 * Updates an existing search index with incremental changes.
 */
export const updateSearchIndex = (
  index: SearchIndex,
  changes: IndexUpdateEvent,
  snapshot: OutlineSnapshot
): SearchIndex => {
  // If structural changes occurred, rebuild the entire index
  if (changes.structuralChange) {
    return createSearchIndex(snapshot);
  }
  
  // Otherwise, perform incremental updates
  // Create mutable copies of the indexes
  const textIndex = new Map<string, Set<NodeId>>();
  const pathIndex = new Map<string, Set<NodeId>>();
  const tagIndex = new Map<string, Set<NodeId>>();
  const typeIndex = new Map<string, Set<NodeId>>();
  const createdIndex = new Map<number, Set<NodeId>>();
  const updatedIndex = new Map<number, Set<NodeId>>();
  
  // Copy existing data
  index.textIndex.forEach((set, key) => {
    textIndex.set(key, new Set(set));
  });
  index.pathIndex.forEach((set, key) => {
    pathIndex.set(key, new Set(set));
  });
  index.tagIndex.forEach((set, key) => {
    tagIndex.set(key, new Set(set));
  });
  index.typeIndex.forEach((set, key) => {
    typeIndex.set(key, new Set(set));
  });
  index.createdIndex.forEach((set, key) => {
    createdIndex.set(key, new Set(set));
  });
  index.updatedIndex.forEach((set, key) => {
    updatedIndex.set(key, new Set(set));
  });
  
  // Remove deleted nodes from all indexes
  changes.deletedNodeIds.forEach(nodeId => {
    removeNodeFromIndexes(nodeId, textIndex, pathIndex, tagIndex, typeIndex, createdIndex, updatedIndex);
  });
  
  // Rebuild indexes for changed nodes
  if (changes.changedNodeIds.size > 0) {
    const pathMap = buildPathMap(snapshot);
    changes.changedNodeIds.forEach(nodeId => {
      const node = snapshot.nodes.get(nodeId);
      if (node) {
        // Remove old entries
        removeNodeFromIndexes(nodeId, textIndex, pathIndex, tagIndex, typeIndex, createdIndex, updatedIndex);
        // Add new entries
        indexNodeText(node, nodeId, textIndex);
        indexNodePath(nodeId, pathMap, snapshot, pathIndex);
        indexNodeMetadata(node, nodeId, tagIndex, typeIndex, createdIndex, updatedIndex);
      }
    });
  }
  
  return {
    textIndex: freezeMap(textIndex),
    pathIndex: freezeMap(pathIndex),
    tagIndex: freezeMap(tagIndex),
    typeIndex: freezeMap(typeIndex),
    createdIndex: freezeMap(createdIndex),
    updatedIndex: freezeMap(updatedIndex),
    version: Date.now()
  };
};

/**
 * Indexes the text content of a node by tokenizing it.
 */
const indexNodeText = (
  node: NodeSnapshot,
  nodeId: NodeId,
  textIndex: Map<string, Set<NodeId>>
): void => {
  const tokens = tokenizeText(node.text);
  tokens.forEach(token => {
    if (!textIndex.has(token)) {
      textIndex.set(token, new Set());
    }
    textIndex.get(token)!.add(nodeId);
  });
};

/**
 * Indexes the path of a node by extracting path segments.
 */
const indexNodePath = (
  nodeId: NodeId,
  pathMap: Map<NodeId, NodeId[]>,
  snapshot: OutlineSnapshot,
  pathIndex: Map<string, Set<NodeId>>
): void => {
  const path = pathMap.get(nodeId);
  if (!path) return;
  
  // Index each segment of the path
  path.forEach(segmentNodeId => {
    const segmentNode = snapshot.nodes.get(segmentNodeId);
    if (segmentNode) {
      const tokens = tokenizeText(segmentNode.text);
      tokens.forEach(token => {
        if (!pathIndex.has(token)) {
          pathIndex.set(token, new Set());
        }
        pathIndex.get(token)!.add(nodeId);
      });
    }
  });
};

/**
 * Indexes metadata fields (tags, type, timestamps) of a node.
 */
const indexNodeMetadata = (
  node: NodeSnapshot,
  nodeId: NodeId,
  tagIndex: Map<string, Set<NodeId>>,
  typeIndex: Map<string, Set<NodeId>>,
  createdIndex: Map<number, Set<NodeId>>,
  updatedIndex: Map<number, Set<NodeId>>
): void => {
  // Index tags
  node.metadata.tags.forEach(tag => {
    if (!tagIndex.has(tag)) {
      tagIndex.set(tag, new Set());
    }
    tagIndex.get(tag)!.add(nodeId);
  });
  
  // Index type (determined by metadata presence)
  const nodeType = determineNodeType(node);
  if (!typeIndex.has(nodeType)) {
    typeIndex.set(nodeType, new Set());
  }
  typeIndex.get(nodeType)!.add(nodeId);
  
  // Index timestamps
  if (!createdIndex.has(node.metadata.createdAt)) {
    createdIndex.set(node.metadata.createdAt, new Set());
  }
  createdIndex.get(node.metadata.createdAt)!.add(nodeId);
  
  if (!updatedIndex.has(node.metadata.updatedAt)) {
    updatedIndex.set(node.metadata.updatedAt, new Set());
  }
  updatedIndex.get(node.metadata.updatedAt)!.add(nodeId);
};

/**
 * Removes a node from all indexes.
 */
const removeNodeFromIndexes = (
  nodeId: NodeId,
  textIndex: Map<string, Set<NodeId>>,
  pathIndex: Map<string, Set<NodeId>>,
  tagIndex: Map<string, Set<NodeId>>,
  typeIndex: Map<string, Set<NodeId>>,
  createdIndex: Map<number, Set<NodeId>>,
  updatedIndex: Map<number, Set<NodeId>>
): void => {
  // Remove from text index
  textIndex.forEach(nodeSet => {
    nodeSet.delete(nodeId);
  });
  
  // Remove from path index
  pathIndex.forEach(nodeSet => {
    nodeSet.delete(nodeId);
  });
  
  // Remove from tag index
  tagIndex.forEach(nodeSet => {
    nodeSet.delete(nodeId);
  });
  
  // Remove from type index
  typeIndex.forEach(nodeSet => {
    nodeSet.delete(nodeId);
  });
  
  // Remove from timestamp indexes
  createdIndex.forEach(nodeSet => {
    nodeSet.delete(nodeId);
  });
  
  updatedIndex.forEach(nodeSet => {
    nodeSet.delete(nodeId);
  });
};

/**
 * Tokenizes text by splitting on whitespace and converting to lowercase.
 */
const tokenizeText = (text: string): string[] => {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(token => token.length > 0);
};

/**
 * Determines the type of a node based on its metadata.
 */
const determineNodeType = (node: NodeSnapshot): string => {
  if (node.metadata.todo) {
    return "todo";
  }
  if (node.metadata.tags.length > 0) {
    return "tagged";
  }
  return "text";
};

/**
 * Builds a map from node ID to its path (array of ancestor node IDs).
 */
const buildPathMap = (snapshot: OutlineSnapshot): Map<NodeId, NodeId[]> => {
  const pathMap = new Map<NodeId, NodeId[]>();
  const queue: Array<{ nodeId: NodeId; path: NodeId[] }> = [];
  
  // Start with root nodes
  snapshot.rootEdgeIds.forEach(rootEdgeId => {
    const rootEdge = snapshot.edges.get(rootEdgeId);
    if (rootEdge) {
      const rootNodeId = rootEdge.childNodeId;
      pathMap.set(rootNodeId, [rootNodeId]);
      queue.push({ nodeId: rootNodeId, path: [rootNodeId] });
    }
  });
  
  // Process all nodes
  while (queue.length > 0) {
    const { nodeId, path } = queue.shift()!;
    const childEdgeIds = snapshot.childrenByParent.get(nodeId) ?? [];
    
    childEdgeIds.forEach(childEdgeId => {
      const childEdge = snapshot.edges.get(childEdgeId);
      if (childEdge) {
        const childNodeId = childEdge.childNodeId;
        if (!pathMap.has(childNodeId)) {
          const childPath = [...path, childNodeId];
          pathMap.set(childNodeId, childPath);
          queue.push({ nodeId: childNodeId, path: childPath });
        }
      }
    });
  }
  
  return pathMap;
};

/**
 * Converts a mutable Map to a readonly Map with frozen Sets.
 */
const freezeMap = <K, V>(map: Map<K, Set<V>>): ReadonlyMap<K, ReadonlySet<V>> => {
  const frozenMap = new Map<K, ReadonlySet<V>>();
  map.forEach((set, key) => {
    frozenMap.set(key, Object.freeze(new Set(set)));
  });
  return Object.freeze(frozenMap);
};
