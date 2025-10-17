import { describe, expect, it } from "vitest";

import { createSharedDocId, createUserDocId } from "../docLocator";
import {
  buildPersistenceDatabaseName,
  buildSessionStorageKey,
  createUserStorageNamespace,
  resolveNamespaceFromDocId
} from "../storageNamespace";

describe("storageNamespace", () => {
  it("creates a user namespace using the thortiq prefix", () => {
    expect(createUserStorageNamespace({ userId: "alice" })).toBe("thortiq::alice");
  });

  it("builds persistence names scoped by user and doc metadata", () => {
    const namespace = createUserStorageNamespace({ userId: "alice" });
    const docId = createUserDocId({ userId: "alice", type: "outline" });
    expect(buildPersistenceDatabaseName({ namespace, docType: "outline", docId })).toBe(
      `thortiq::alice::sync::outline:${docId}`
    );
  });

  it("builds session storage keys scoped by user", () => {
    const namespace = createUserStorageNamespace({ userId: "alice" });
    expect(buildSessionStorageKey({ namespace })).toBe("thortiq::alice::session::v1");
  });

  it("derives the same namespace from a doc id", () => {
    const docId = createUserDocId({ userId: "bob", type: "outline" });
    expect(resolveNamespaceFromDocId({ docId })).toBe("thortiq::bob");
  });

  it("derives a namespace for shared documents using the owner id", () => {
    const docId = createSharedDocId({ resourceId: "share-xyz", type: "outline" });
    expect(resolveNamespaceFromDocId({ docId })).toBe("thortiq::share-xyz");
  });
});
