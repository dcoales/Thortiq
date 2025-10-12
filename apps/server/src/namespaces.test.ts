import { describe, expect, it } from "vitest";

import { createUserDocId } from "@thortiq/client-core";

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
});
