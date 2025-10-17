/**
 * Doc locator helpers keep sync identifiers consistent across clients and the sync server.
 * IDs must remain URL-safe and avoid path separators because the sync endpoint treats the
 * document id as a single path segment (`/sync/v1/{docId}`).
 */

export type DocScope = "user" | "shared";

export type DocType = "outline" | "preferences" | "presence";

export interface DocLocator {
  readonly docId: string;
  readonly scope: DocScope;
  readonly type: DocType;
  readonly ownerId: string;
  readonly resourceId?: string | null;
}

const DOC_ID_PREFIX = "thq.v1";
const SEGMENT_DELIMITER = ":";

const hasDelimiter = (value: string): boolean => value.includes(SEGMENT_DELIMITER);

const encodeSegment = (value: string): string => {
  if (value.length === 0) {
    throw new Error("Doc id segments must be non-empty");
  }
  if (hasDelimiter(value)) {
    throw new Error(`Doc id segments must not contain "${SEGMENT_DELIMITER}"`);
  }
  return value;
};

const buildDocId = (segments: ReadonlyArray<string>): string => {
  return segments.join(SEGMENT_DELIMITER);
};

export interface CreateDocIdOptions {
  readonly scope: DocScope;
  readonly type: DocType;
  readonly ownerId: string;
  readonly resourceId?: string | null;
}

export const createDocId = (options: CreateDocIdOptions): string => {
  const segments = [
    DOC_ID_PREFIX,
    encodeSegment(options.scope),
    encodeSegment(options.type),
    encodeSegment(options.ownerId)
  ];
  if (options.resourceId) {
    segments.push(encodeSegment(options.resourceId));
  }
  return buildDocId(segments);
};

export interface CreateUserDocIdOptions {
  readonly userId: string;
  readonly type: DocType;
}

export const createUserDocId = (options: CreateUserDocIdOptions): string => {
  return createDocId({ scope: "user", type: options.type, ownerId: options.userId });
};

export interface CreateSharedDocIdOptions {
  readonly resourceId: string;
  readonly type: DocType;
}

export const createSharedDocId = (options: CreateSharedDocIdOptions): string => {
  return createDocId({ scope: "shared", type: options.type, ownerId: options.resourceId });
};

export const parseDocId = (docId: string): DocLocator | null => {
  if (!docId || typeof docId !== "string") {
    return null;
  }
  const segments = docId.split(SEGMENT_DELIMITER);
  if (segments.length < 4 || segments[0] !== DOC_ID_PREFIX) {
    return null;
  }
  const scope = segments[1] as DocScope;
  const type = segments[2] as DocType;
  const ownerId = segments[3];
  const resourceId = segments.length > 4 ? segments.slice(4).join(SEGMENT_DELIMITER) : null;
  if ((scope !== "user" && scope !== "shared") || (type !== "outline" && type !== "preferences" && type !== "presence")) {
    return null;
  }
  if (!ownerId) {
    return null;
  }
  return {
    docId,
    scope,
    type,
    ownerId,
    resourceId
  };
};

export const docIdBelongsToUser = (docId: string, userId: string): boolean => {
  const parsed = parseDocId(docId);
  if (!parsed) {
    return false;
  }
  return parsed.scope === "user" && parsed.ownerId === userId;
};

export const isDocIdShareable = (docId: string): boolean => {
  const parsed = parseDocId(docId);
  if (!parsed) {
    return false;
  }
  return parsed.scope === "shared" || parsed.type === "presence";
};

export const DOC_NAMESPACE_PREFIX = DOC_ID_PREFIX;
