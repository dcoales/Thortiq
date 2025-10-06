import { Schema, type MarkSpec } from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";

const wikilinkMarkSpec: MarkSpec = {
  attrs: {
    nodeId: {}
  },
  inclusive: false,
  parseDOM: [
    {
      tag: "span[data-wikilink]",
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) {
          return false;
        }
        const nodeId = dom.getAttribute("data-node-id");
        return nodeId ? { nodeId } : false;
      }
    }
  ],
  toDOM: (mark) => [
    "span",
    { "data-wikilink": "true", "data-node-id": String(mark.attrs.nodeId) },
    0
  ]
};

const tagMarkSpec: MarkSpec = {
  attrs: {
    name: {},
    color: { default: "#3b82f6" }
  },
  inclusive: false,
  parseDOM: [
    {
      tag: "span[data-tag]",
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) {
          return false;
        }
        const name = dom.getAttribute("data-tag-name");
        const color = dom.getAttribute("data-tag-color");
        return name ? { name, color: color ?? "#3b82f6" } : false;
      }
    }
  ],
  toDOM: (mark) => {
    const color = String(mark.attrs.color);
    // Calculate text color based on background luminance
    const getTextColor = (bgColor: string): string => {
      const hex = bgColor.replace("#", "");
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
      return luminance > 0.5 ? "#000000" : "#ffffff";
    };
    
    return [
      "span",
      {
        "data-tag": "true",
        "data-tag-name": String(mark.attrs.name),
        "data-tag-color": color,
        "style": `background-color: ${color}; color: ${getTextColor(color)};`
      },
      0
    ];
  }
};

const marksConstructor = basicSchema.spec.marks.constructor as unknown as {
  from: (value: Record<string, MarkSpec>) => typeof basicSchema.spec.marks;
};

const marks = basicSchema.spec.marks.append(
  marksConstructor.from({
    wikilink: wikilinkMarkSpec,
    tag: tagMarkSpec
  })
);

export const editorSchema = new Schema({
  nodes: basicSchema.spec.nodes,
  marks
});

export type EditorSchema = typeof editorSchema;
