import { describe, expect, it } from "vitest";

import { DOMParser } from "prosemirror-model";

import { editorSchema } from "./schema";

describe("editorSchema tag mark", () => {
  it("registers a non-inclusive tag mark with required attributes", () => {
    const tag = editorSchema.marks.tag;
    expect(tag).toBeDefined();
    expect(tag.spec.inclusive).toBe(false);
    expect(Object.keys(tag.spec.attrs ?? {})).toEqual(["id", "trigger", "label"]);
  });

  it("round-trips tag attributes via DOM parsing and serialization", () => {
    const tag = editorSchema.marks.tag;
    if (!tag || !tag.spec.toDOM) {
      throw new Error("Tag mark is not registered.");
    }

    const mark = tag.create({ id: "launch", trigger: "#", label: "Launch" });
    const domSpec = tag.spec.toDOM(mark, false);
    if (!Array.isArray(domSpec)) {
      throw new Error("Tag mark toDOM must return a DOMOutputSpec tuple.");
    }
    expect(domSpec).toEqual([
      "span",
      {
        "data-tag": "true",
        "data-tag-id": "launch",
        "data-tag-trigger": "#",
        "data-tag-label": "Launch"
      },
      0
    ]);

    const [tagName, attributes] = domSpec as [string, Record<string, string>, 0];
    const element = document.createElement(tagName);
    const attrs = attributes as Record<string, string>;
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
    element.textContent = "Launch";

    const parser = DOMParser.fromSchema(editorSchema);
    const paragraph = document.createElement("p");
    paragraph.appendChild(element);
    const container = document.createElement("div");
    container.appendChild(paragraph);

    const doc = parser.parse(container);
    const parsedMarks = doc.firstChild?.firstChild?.marks ?? [];
    expect(parsedMarks).toHaveLength(1);
    expect(parsedMarks[0]?.type.name).toBe("tag");
    expect(parsedMarks[0]?.attrs).toEqual({ id: "launch", trigger: "#", label: "Launch" });
  });
});
