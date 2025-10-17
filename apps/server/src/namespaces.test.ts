import { describe, expect, it } from "vitest";

import { createSharedDocId, createUserDocId } from "@thortiq/client-core";

import { authorizeDocAccess, decodeDocId } from "./namespaces";

describe("namespaces", () => {
  it("decodes encoded doc ids", () => {
    expect(decodeDocId("thq.v1%3Auser%3Aoutline%3Atest"))
      .toBe("thq.v1:user:outline:test");
  });

  it("authorises owner access", () => {
    const docId = createUserDocId({ userId: "owner", type: "outline" });

    expect(authorizeDocAccess(docId, "owner")).not.toBeNull();
    expect(authorizeDocAccess(docId, "other")).toBeNull();
  });

  it("denies shared documents without permission", () => {
    const docId = createSharedDocId({ resourceId: "share-123", type: "outline" });

    expect(authorizeDocAccess(docId, "owner")).toBeNull();
  });

  it("allows shared documents when the authorizer approves", () => {
    const docId = createSharedDocId({ resourceId: "share-123", type: "outline" });
    const access = authorizeDocAccess(docId, "collaborator", (doc, userId) => {
      return doc.ownerId === "share-123" && userId === "collaborator";
    });

    expect(access).not.toBeNull();
    expect(access?.scope).toBe("shared");
    expect(access?.ownerId).toBe("share-123");
  });
});
