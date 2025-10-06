import { describe, expect, it } from "vitest";

import { parseSearchQuery } from "./parser";
import type {
  SearchAndExpression,
  SearchTermExpression
} from "./types";

describe("parseSearchQuery", () => {
  it("parses field expressions with boolean connectors", () => {
    const result = parseSearchQuery('text:"hello" AND tag:work');

    expect(result.errors).toHaveLength(0);
    expect(result.expression?.kind).toBe("and");
    const expression = result.expression as SearchAndExpression;
    expect(expression.left.kind).toBe("term");
    expect((expression.left as SearchTermExpression).term.field).toBe("text");
    expect(expression.right.kind).toBe("term");
    expect((expression.right as SearchTermExpression).term.field).toBe("tag");
  });

  it("parses tag shorthand and grouping", () => {
    const result = parseSearchQuery("(#inbox OR #today) AND NOT text:archive");

    expect(result.errors).toHaveLength(0);
    expect(result.expression?.kind).toBe("and");
  });

  it("parses range expressions as bounded comparisons", () => {
    const result = parseSearchQuery("created:[2024-01-01..2024-12-31]");

    expect(result.errors).toHaveLength(0);
    expect(result.expression?.kind).toBe("and");
    const expression = result.expression as SearchAndExpression;
    const left = expression.left as SearchTermExpression;
    const right = expression.right as SearchTermExpression;
    expect(left.term.operator).toBe("gte");
    expect(right.term.operator).toBe("lte");
  });

  it("returns parse errors for unterminated input", () => {
    const result = parseSearchQuery('text:"unterminated');

    expect(result.expression).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

