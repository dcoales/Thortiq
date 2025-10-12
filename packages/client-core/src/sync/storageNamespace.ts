/**
 * Shared helpers for deriving per-user storage namespaces. Multi-user environments must avoid
 * leaking cached data (IndexedDB, localStorage, etc.) between accounts, so we consistently prefix
 * storage keys with `thortiq::<userId>` and suffix them with the relevant resource metadata.
 */
import { parseDocId, type DocType } from "./docLocator";

const STORAGE_NAMESPACE_PREFIX = "thortiq";
const SESSION_KEY_VERSION = "v1";

const joinSegments = (segments: ReadonlyArray<string>): string => segments.join("::");

const encodeSegment = (segment: string): string => {
  if (segment.length === 0) {
    throw new Error("Storage namespace segments must be non-empty");
  }
  return segment;
};

export interface StorageNamespaceOptions {
  readonly userId: string;
}

export const createUserStorageNamespace = (options: StorageNamespaceOptions): string => {
  const userId = encodeSegment(options.userId);
  return joinSegments([STORAGE_NAMESPACE_PREFIX, userId]);
};

export interface PersistenceKeyOptions {
  readonly namespace: string;
  readonly docType: DocType;
  readonly docId: string;
}

export const buildPersistenceDatabaseName = (options: PersistenceKeyOptions): string => {
  const suffix = `${options.docType}:${options.docId}`;
  return joinSegments([options.namespace, "sync", suffix]);
};

export interface SessionStorageKeyOptions {
  readonly namespace: string;
  readonly version?: string;
}

export const buildSessionStorageKey = (options: SessionStorageKeyOptions): string => {
  const version = options.version ?? SESSION_KEY_VERSION;
  return joinSegments([options.namespace, "session", version]);
};

export interface ResolveNamespaceFromDocIdOptions {
  readonly docId: string;
}

export const resolveNamespaceFromDocId = (options: ResolveNamespaceFromDocIdOptions): string | null => {
  const parsed = parseDocId(options.docId);
  if (!parsed) {
    return null;
  }
  if (!parsed.ownerId) {
    return null;
  }
  return createUserStorageNamespace({ userId: parsed.ownerId });
};
