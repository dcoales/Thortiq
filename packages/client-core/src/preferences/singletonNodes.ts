/**
 * Singleton node preferences track outline-level roles such as the Inbox and Journal.
 * These helpers keep storage inside the Yjs-backed userPreferences map so platform adapters
 * can request or update assignments without duplicating persistence logic.
 */
import * as Y from "yjs";

import type { OutlineDoc } from "../types";
import type { NodeId } from "../ids";
import { nodeExists, withTransaction } from "../doc";

type SingletonRole = "inbox" | "journal";

interface SingletonRecordSnapshot {
  readonly nodeId: NodeId;
  readonly assignedAt: number;
}

const SINGLETON_KEY_PREFIX = "singleton.node.";

const resolveRoleKey = (role: SingletonRole): string => `${SINGLETON_KEY_PREFIX}${role}`;

const readSingletonRecord = (record: unknown): SingletonRecordSnapshot | null => {
  if (!(record instanceof Y.Map)) {
    return null;
  }
  const nodeId = record.get("nodeId");
  const assignedAt = record.get("assignedAt");
  if (typeof nodeId !== "string" || typeof assignedAt !== "number") {
    return null;
  }
  return {
    nodeId: nodeId as NodeId,
    assignedAt
  };
};

const ensureSingletonRecord = (outline: OutlineDoc, role: SingletonRole): Y.Map<unknown> => {
  const key = resolveRoleKey(role);
  const existing = outline.userPreferences.get(key);
  if (existing instanceof Y.Map) {
    return existing as Y.Map<unknown>;
  }
  const record = new Y.Map<unknown>();
  outline.userPreferences.set(key, record);
  return record;
};

const writeSingletonRecord = (
  outline: OutlineDoc,
  role: SingletonRole,
  nodeId: NodeId,
  origin?: unknown
): void => {
  if (!nodeExists(outline, nodeId)) {
    throw new Error(`Cannot assign ${role} to missing node ${nodeId}`);
  }

  withTransaction(
    outline,
    () => {
      const record = ensureSingletonRecord(outline, role);
      record.set("nodeId", nodeId);
      record.set("assignedAt", Date.now());
    },
    origin
  );
};

const clearSingletonRecord = (outline: OutlineDoc, role: SingletonRole, origin?: unknown): void => {
  const key = resolveRoleKey(role);
  if (!outline.userPreferences.has(key)) {
    return;
  }
  withTransaction(
    outline,
    () => {
      outline.userPreferences.delete(key);
    },
    origin
  );
};

const getSingletonSnapshot = (outline: OutlineDoc, role: SingletonRole): SingletonRecordSnapshot | null => {
  const key = resolveRoleKey(role);
  const record = outline.userPreferences.get(key);
  return readSingletonRecord(record);
};

export const getInboxNodeId = (outline: OutlineDoc): NodeId | null => {
  return getSingletonSnapshot(outline, "inbox")?.nodeId ?? null;
};

export const getJournalNodeId = (outline: OutlineDoc): NodeId | null => {
  return getSingletonSnapshot(outline, "journal")?.nodeId ?? null;
};

export const setInboxNodeId = (
  outline: OutlineDoc,
  nodeId: NodeId,
  origin?: unknown
): void => {
  writeSingletonRecord(outline, "inbox", nodeId, origin);
};

export const setJournalNodeId = (
  outline: OutlineDoc,
  nodeId: NodeId,
  origin?: unknown
): void => {
  writeSingletonRecord(outline, "journal", nodeId, origin);
};

export const clearInboxNode = (outline: OutlineDoc, origin?: unknown): void => {
  clearSingletonRecord(outline, "inbox", origin);
};

export const clearJournalNode = (outline: OutlineDoc, origin?: unknown): void => {
  clearSingletonRecord(outline, "journal", origin);
};

export const getInboxSnapshot = (outline: OutlineDoc): SingletonRecordSnapshot | null => {
  return getSingletonSnapshot(outline, "inbox");
};

export const getJournalSnapshot = (outline: OutlineDoc): SingletonRecordSnapshot | null => {
  return getSingletonSnapshot(outline, "journal");
};
