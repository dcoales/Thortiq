import { describe, expect, it } from "vitest";

import { parseSearchQuery } from "../queryParser";

describe("parseSearchQuery", () => {
  it("parses field predicates with quoted literals", () => {
    const result = parseSearchQuery('text:"Project Plan"');
    expect(result.type).toBe("success");
    if (result.type !== "success") {
      return;
    }
    expect(result.expression).toEqual({
      type: "predicate",
      field: "text",
      comparator: ":",
      value: { kind: "string", value: "project plan" }
    });
  });

  it("supports boolean precedence with implicit AND", () => {
    const result = parseSearchQuery('tag:urgent OR tag:important text:"release"');
    expect(result.type).toBe("success");
    if (result.type !== "success") {
      return;
    }
    expect(result.expression).toEqual({
      type: "binary",
      operator: "OR",
      left: {
        type: "predicate",
        field: "tag",
        comparator: ":",
        value: { kind: "string", value: "urgent" }
      },
      right: {
        type: "binary",
        operator: "AND",
        left: {
          type: "predicate",
          field: "tag",
          comparator: ":",
          value: { kind: "string", value: "important" }
        },
        right: {
          type: "predicate",
          field: "text",
          comparator: ":",
          value: { kind: "string", value: "release" }
        }
      }
    });
  });

  it("parses NOT unary expressions", () => {
    const result = parseSearchQuery("NOT #archived");
    expect(result.type).toBe("success");
    if (result.type !== "success") {
      return;
    }
    expect(result.expression).toEqual({
      type: "not",
      operand: {
        type: "predicate",
        field: "tag",
        comparator: ":",
        value: { kind: "string", value: "archived" }
      }
    });
  });

  it("parses range literals with inclusive boundaries", () => {
    const result = parseSearchQuery("created:[2024-01-01..2024-12-31]");
    expect(result.type).toBe("success");
    if (result.type !== "success") {
      return;
    }
    const predicate = result.expression;
    expect(predicate).toMatchObject({
      type: "predicate",
      field: "created",
      comparator: ":",
      value: {
        kind: "range",
        start: { kind: "date", raw: "2024-01-01" },
        end: { kind: "date", raw: "2024-12-31" }
      }
    });
    if (predicate.type === "predicate" && predicate.value.kind === "range") {
      expect(predicate.value.start).toMatchObject({ value: Date.parse("2024-01-01") });
      expect(predicate.value.end).toMatchObject({ value: Date.parse("2024-12-31") });
    }
  });

  it("parses comparison operators for date fields", () => {
    const result = parseSearchQuery('updated >= "2024-02-01"');
    expect(result.type).toBe("success");
    if (result.type !== "success") {
      return;
    }
    expect(result.expression).toEqual({
      type: "predicate",
      field: "updated",
      comparator: ">=",
      value: {
        kind: "date",
        value: Date.parse("2024-02-01"),
        raw: "2024-02-01"
      }
    });
  });

  it("treats bare words as text predicates", () => {
    const result = parseSearchQuery("Launch Checklist");
    expect(result.type).toBe("success");
    if (result.type !== "success") {
      return;
    }
    expect(result.expression).toEqual({
      type: "binary",
      operator: "AND",
      left: {
        type: "predicate",
        field: "text",
        comparator: ":",
        value: { kind: "string", value: "launch" }
      },
      right: {
        type: "predicate",
        field: "text",
        comparator: ":",
        value: { kind: "string", value: "checklist" }
      }
    });
  });

  it("returns parse errors with column offsets", () => {
    const result = parseSearchQuery("text:");
    expect(result.type).toBe("error");
    if (result.type !== "error") {
      return;
    }
    expect(result.error.message).toContain("Missing literal");
    expect(result.error.start).toBeGreaterThanOrEqual(4);
  });
});
