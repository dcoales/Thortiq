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

const marksConstructor = basicSchema.spec.marks.constructor as unknown as {
  from: (value: Record<string, MarkSpec>) => typeof basicSchema.spec.marks;
};

const marks = basicSchema.spec.marks.append(
  marksConstructor.from({
    wikilink: wikilinkMarkSpec
  })
);

export const editorSchema = new Schema({
  nodes: basicSchema.spec.nodes,
  marks
});

export type EditorSchema = typeof editorSchema;
