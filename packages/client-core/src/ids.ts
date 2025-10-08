/**
 * Identifier utilities for the collaborative outline. All IDs are ULIDs to ensure
 * sortable, unique values that remain stable across clients and replicas.
 */
import { ulid } from "ulidx";

export type NodeId = string;
export type EdgeId = string;
export type EdgeInstanceId = EdgeId;

/**
 * Generates a new node identifier. IDs are ULIDs so they sort chronologically while
 * remaining collision-resistant for offline creation.
 */
export const createNodeId = (): NodeId => ulid();

/**
 * Generates a new edge identifier so mirrors and structural edges remain unique.
 */
export const createEdgeId = (): EdgeId => ulid();

/**
 * Generates a deterministic edge instance identifier for a specific parent/child pairing. Mirrors
 * reuse canonical child edges, so composing the IDs keeps child projections unique per parent
 * while remaining stable across snapshot rebuilds.
 */
export const createEdgeInstanceId = (parentEdgeId: EdgeId, childEdgeId: EdgeId): EdgeInstanceId => {
  return `${parentEdgeId}::${childEdgeId}`;
};

/**
 * Convenience equality guard that keeps comparisons explicit at call sites.
 */
export const isSameNode = (a: NodeId, b: NodeId): boolean => a === b;
