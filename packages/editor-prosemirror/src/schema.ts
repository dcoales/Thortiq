import OrderedMap from "orderedmap";
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

const marks = basicSchema.spec.marks.append(
  OrderedMap.from({
    wikilink: wikilinkMarkSpec
  })
);

export const editorSchema = new Schema({
  nodes: basicSchema.spec.nodes,
  marks
});

export type EditorSchema = typeof editorSchema;
