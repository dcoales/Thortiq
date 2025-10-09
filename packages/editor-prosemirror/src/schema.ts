/**
 * ProseMirror schema extension that introduces collaborative inline marks shared by every
 * editor instance. Tag marks are inline, non-inclusive pills that serialise to span elements
 * with deterministic data attributes so Yjs snapshots round-trip consistently across platforms.
 */
import OrderedMap from "orderedmap";
import { Schema, type MarkSpec } from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";

const underlineMarkSpec: MarkSpec = {
  inclusive: true,
  parseDOM: [
    {
      tag: "u"
    },
    {
      tag: "span[data-underline]",
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) {
          return false;
        }
        return dom.getAttribute("data-underline") ? {} : false;
      }
    }
  ],
  toDOM: () => [
    "span",
    {
      "data-underline": "true",
      style: "text-decoration: underline"
    },
    0
  ]
};

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
    id: {},
    trigger: {},
    label: {}
  },
  inclusive: false,
  parseDOM: [
    {
      tag: "span[data-tag]",
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) {
          return false;
        }
        const id = dom.getAttribute("data-tag-id");
        const trigger = dom.getAttribute("data-tag-trigger");
        const label = dom.getAttribute("data-tag-label");
        if (!id || !label) {
          return false;
        }
        if (trigger !== "#" && trigger !== "@") {
          return false;
        }
        return { id, trigger, label };
      }
    }
  ],
  toDOM: (mark) => [
    "span",
    {
      "data-tag": "true",
      "data-tag-id": String(mark.attrs.id),
      "data-tag-trigger": String(mark.attrs.trigger),
      "data-tag-label": String(mark.attrs.label)
    },
    0
  ]
};

const marks = basicSchema.spec.marks.append(
  OrderedMap.from({
    underline: underlineMarkSpec,
    wikilink: wikilinkMarkSpec,
    tag: tagMarkSpec
  })
);

export const editorSchema = new Schema({
  nodes: basicSchema.spec.nodes,
  marks
});

export type EditorSchema = typeof editorSchema;
