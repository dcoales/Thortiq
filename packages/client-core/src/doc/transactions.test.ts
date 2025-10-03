import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { outlineFromDoc, createOutlineDoc, withTransaction } from "./transactions";

describe("transactions module", () => {
  it("creates independent collaborative document instances", () => {
    const outlineA = createOutlineDoc();
    const outlineB = createOutlineDoc();

    expect(outlineA).not.toBe(outlineB);
    expect(outlineA.nodes.size).toBe(0);
    expect(outlineB.edges.size).toBe(0);
  });

  it("hydrates a fresh outline from an existing Y.Doc", () => {
    const base = createOutlineDoc();
    const clone = outlineFromDoc(base.doc);

    expect(clone.doc).toBe(base.doc);
    expect(clone.nodes).toBeInstanceOf(Y.Map);
    expect(clone.edges).toBeInstanceOf(Y.Map);
  });

  it("wraps mutations in a single Yjs transaction", () => {
    const outline = createOutlineDoc();

    let transactionCount = 0;
    outline.doc.on("afterTransaction", () => {
      transactionCount += 1;
    });

    const result = withTransaction(outline, (transaction) => {
      outline.rootEdges.push(["edge" as never]);
      expect(transaction instanceof Y.Transaction).toBe(true);
      return "done";
    });

    expect(result).toBe("done");
    expect(transactionCount).toBe(1);
  });
});
