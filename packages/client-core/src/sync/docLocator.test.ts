import { describe, expect, it } from "vitest";

import {
  DOC_NAMESPACE_PREFIX,
  createDocId,
  createSharedDocId,
  createUserDocId,
  docIdBelongsToUser,
  isDocIdShareable,
  parseDocId
} from "./docLocator";

describe("docLocator", () => {
  it("creates user doc ids without collisions", () => {
    const docId = createUserDocId({ userId: "user-123", type: "outline" });

    expect(docId).toBe(`${DOC_NAMESPACE_PREFIX}:user:outline:user-123`);
  });

  it("parses user doc ids", () => {
    const docId = createUserDocId({ userId: "alice", type: "preferences" });

    const parsed = parseDocId(docId);

    expect(parsed).toEqual({
      docId,
      scope: "user",
      type: "preferences",
      ownerId: "alice",
      resourceId: null
    });
  });

  it("returns null for invalid doc ids", () => {
    expect(parseDocId("outline-only")).toBeNull();
    expect(parseDocId("thq.v1:invalid-scope:outline:user")).toBeNull();
    expect(parseDocId("thq.v1:user:invalid-type:user")).toBeNull();
  });

  it("detects user ownership", () => {
    const docId = createUserDocId({ userId: "owner", type: "outline" });

    expect(docIdBelongsToUser(docId, "owner")).toBe(true);
    expect(docIdBelongsToUser(docId, "other")).toBe(false);
  });

  it("creates shareable doc ids", () => {
    const docId = createSharedDocId({ resourceId: "share-123", type: "outline" });

    expect(docId).toBe(`${DOC_NAMESPACE_PREFIX}:shared:outline:share-123`);
    expect(isDocIdShareable(docId)).toBe(true);
  });

  it("flags presence docs as shareable by default", () => {
    const docId = createUserDocId({ userId: "user-1", type: "presence" });

    expect(isDocIdShareable(docId)).toBe(true);
  });

  it("throws when segments include delimiters", () => {
    expect(() =>
      createDocId({ scope: "user", type: "outline", ownerId: "invalid:segment" })
    ).toThrowError(/Doc id segments must not contain/);
  });
});
