import {
  createUserDocId,
  docIdBelongsToUser,
  parseDocId,
  type DocLocator,
  type DocType
} from "@thortiq/client-core";

export interface NamespaceCheckResult extends DocLocator {}

export const decodeDocId = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch (_error) {
    return raw;
  }
};

export type ShareAccessAuthorizer = (doc: DocLocator, userId: string) => boolean;

export const authorizeDocAccess = (
  docId: string,
  userId: string,
  canAccessShared?: ShareAccessAuthorizer
): NamespaceCheckResult | null => {
  const parsed = parseDocId(docId);
  if (!parsed) {
    return null;
  }
  if (docIdBelongsToUser(docId, userId)) {
    return parsed;
  }
  if (parsed.scope === "shared" && canAccessShared?.(parsed, userId)) {
    return parsed;
  }
  return null;
};

export const createDefaultOutlineDocId = (userId: string): string => {
  return createUserDocId({ userId, type: "outline" });
};

export const isDocTypeAllowed = (type: DocType): boolean => {
  return type === "outline" || type === "preferences" || type === "presence";
};
