/**
 * Shared Yjs map/array keys for the collaborative outline document. Keeping them here avoids
 * accidental drift between node, edge, and transaction helpers across modules.
 */
export const NODES_COLLECTION_KEY = "nodes";
export const EDGES_COLLECTION_KEY = "edges";
export const ROOT_EDGES_KEY = "rootEdges";
export const CHILD_EDGE_MAP_KEY = "childEdgeMap";
export const TAG_REGISTRY_KEY = "tagRegistry";

export const NODE_TEXT_XML_KEY = "textXml";
export const NODE_METADATA_KEY = "metadata";

export const EDGE_PARENT_NODE_KEY = "parentNodeId";
export const EDGE_CHILD_NODE_KEY = "childNodeId";
export const EDGE_COLLAPSED_KEY = "collapsed";
export const EDGE_MIRROR_KEY = "mirrorOfNodeId";
export const EDGE_POSITION_KEY = "position";
