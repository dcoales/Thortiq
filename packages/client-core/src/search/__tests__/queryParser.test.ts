/**
 * Unit tests for the search query parser.
 */
import { describe, it, expect } from "vitest";
import { parseSearchQuery, SearchParseError } from "../queryParser";

describe("parseSearchQuery", () => {
  it("should parse simple text queries", () => {
    const query = parseSearchQuery("hello");
    expect(query).toEqual({
      type: "field",
      field: "text",
      operator: ":",
      value: "hello"
    });
  });

  it("should parse implicit AND queries for multiple words", () => {
    const query = parseSearchQuery("hello world");
    expect(query).toEqual({
      type: "boolean",
      operator: "AND",
      left: {
        type: "field",
        field: "text",
        operator: ":",
        value: "hello"
      },
      right: {
        type: "field",
        field: "text",
        operator: ":",
        value: "world"
      }
    });
  });

  it("should parse multiple words with explicit AND", () => {
    const query = parseSearchQuery("hello AND world");
    expect(query).toEqual({
      type: "boolean",
      operator: "AND",
      left: {
        type: "field",
        field: "text",
        operator: ":",
        value: "hello"
      },
      right: {
        type: "field",
        field: "text",
        operator: ":",
        value: "world"
      }
    });
  });

  it("should parse three words as implicit AND", () => {
    const query = parseSearchQuery("hello world test");
    expect(query).toEqual({
      type: "boolean",
      operator: "AND",
      left: {
        type: "field",
        field: "text",
        operator: ":",
        value: "hello"
      },
      right: {
        type: "boolean",
        operator: "AND",
        left: {
          type: "field",
          field: "text",
          operator: ":",
          value: "world"
        },
        right: {
          type: "field",
          field: "text",
          operator: ":",
          value: "test"
        }
      }
    });
  });

  it("should parse field queries", () => {
    const query = parseSearchQuery("text:hello");
    expect(query).toEqual({
      type: "field",
      field: "text",
      operator: ":",
      value: "hello"
    });
  });

  it("should parse tag shorthand", () => {
    const query = parseSearchQuery("#important");
    expect(query).toEqual({
      type: "field",
      field: "tag",
      operator: ":",
      value: "important"
    });
  });

  it("should parse quoted strings", () => {
    const query = parseSearchQuery('text:"hello world"');
    expect(query).toEqual({
      type: "field",
      field: "text",
      operator: ":",
      value: "hello world"
    });
  });

  it("should parse boolean AND queries", () => {
    const query = parseSearchQuery("text:hello AND tag:important");
    expect(query).toEqual({
      type: "boolean",
      operator: "AND",
      left: {
        type: "field",
        field: "text",
        operator: ":",
        value: "hello"
      },
      right: {
        type: "field",
        field: "tag",
        operator: ":",
        value: "important"
      }
    });
  });

  it("should parse boolean OR queries", () => {
    const query = parseSearchQuery("text:hello OR text:world");
    expect(query).toEqual({
      type: "boolean",
      operator: "OR",
      left: {
        type: "field",
        field: "text",
        operator: ":",
        value: "hello"
      },
      right: {
        type: "field",
        field: "text",
        operator: ":",
        value: "world"
      }
    });
  });

  it("should parse NOT queries", () => {
    const query = parseSearchQuery("NOT text:hello");
    expect(query).toEqual({
      type: "boolean",
      operator: "NOT",
      left: {
        type: "field",
        field: "text",
        operator: ":",
        value: "hello"
      }
    });
  });

  it("should parse grouped queries", () => {
    const query = parseSearchQuery("(text:hello OR text:world) AND tag:important");
    expect(query).toEqual({
      type: "boolean",
      operator: "AND",
      left: {
        type: "group",
        query: {
          type: "boolean",
          operator: "OR",
          left: {
            type: "field",
            field: "text",
            operator: ":",
            value: "hello"
          },
          right: {
            type: "field",
            field: "text",
            operator: ":",
            value: "world"
          }
        }
      },
      right: {
        type: "field",
        field: "tag",
        operator: ":",
        value: "important"
      }
    });
  });

  it("should parse comparison operators", () => {
    const queries = [
      "created:>2024-01-01",
      "updated:<2024-12-31",
      "created:>=2024-01-01",
      "updated:<=2024-12-31",
      "created:=2024-01-01",
      "updated:!=2024-01-01"
    ];

    queries.forEach(queryString => {
      const query = parseSearchQuery(queryString);
      expect(query.type).toBe("field");
      if (query.type === "field") {
        expect(["created", "updated"]).toContain(query.field);
        expect([">", "<", ">=", "<=", "=", "!="]).toContain(query.operator);
      }
    });
  });

  it("should handle case-insensitive boolean operators", () => {
    const queries = [
      "text:hello and tag:important",
      "text:hello or tag:important",
      "not text:hello"
    ];

    queries.forEach(queryString => {
      const query = parseSearchQuery(queryString);
      expect(query.type).toBe("boolean");
      if (query.type === "boolean") {
        expect(["AND", "OR", "NOT"]).toContain(query.operator);
      }
    });
  });

  it("should throw error for invalid syntax", () => {
    expect(() => parseSearchQuery("text:")).toThrow(SearchParseError);
    expect(() => parseSearchQuery("AND text:hello")).toThrow(SearchParseError);
    expect(() => parseSearchQuery("text:hello AND")).toThrow(SearchParseError);
    expect(() => parseSearchQuery("(text:hello")).toThrow(SearchParseError);
    expect(() => parseSearchQuery('text:"hello')).toThrow(SearchParseError);
  });

  it("should handle empty queries", () => {
    const query = parseSearchQuery("");
    expect(query).toEqual({
      type: "field",
      field: "text",
      operator: ":",
      value: ""
    });
  });

  it("should handle whitespace", () => {
    const query = parseSearchQuery("  text:hello  ");
    expect(query).toEqual({
      type: "field",
      field: "text",
      operator: ":",
      value: "hello"
    });
  });
});
