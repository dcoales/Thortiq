/**
 * Shared outline domain primitives for Thortiq. Phase 1 keeps this module focused on
 * providing stable identifiers and placeholder guards until richer Yjs integration arrives.
 */

export type NodeId = string;

/**
 * Generates cryptographically strong identifiers so outline nodes maintain stable identity.
 */
export const createNodeId = (): NodeId => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const randomPart = Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(16)}-${randomPart}`;
};

/**
 * Checks whether two identifiers point to the same logical node.
 */
export const isSameNode = (a: NodeId, b: NodeId): boolean => {
  return a === b;
};
