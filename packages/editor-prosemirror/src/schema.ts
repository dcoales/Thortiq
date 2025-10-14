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

const strikethroughMarkSpec: MarkSpec = {
  inclusive: true,
  parseDOM: [
    {
      tag: "s"
    },
    {
      tag: "del"
    },
    {
      tag: "strike"
    },
    {
      tag: "span[data-strikethrough]",
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) {
          return false;
        }
        return dom.getAttribute("data-strikethrough") ? {} : false;
      }
    }
  ],
  toDOM: () => [
    "span",
    {
      "data-strikethrough": "true",
      style: "text-decoration: line-through"
    },
    0
  ]
};

const textColorMarkSpec: MarkSpec = {
  attrs: {
    color: {}
  },
  inclusive: true,
  parseDOM: [
    {
      tag: "span[data-text-color]",
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) {
          return false;
        }
        const color = dom.getAttribute("data-text-color");
        if (!color) {
          return false;
        }
        return { color };
      }
    }
  ],
  toDOM: (mark) => [
    "span",
    {
      "data-text-color": String(mark.attrs.color),
      style: `color: ${String(mark.attrs.color)}`
    },
    0
  ]
};

const backgroundColorMarkSpec: MarkSpec = {
  attrs: {
    color: {}
  },
  inclusive: true,
  parseDOM: [
    {
      tag: "span[data-background-color]",
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) {
          return false;
        }
        const color = dom.getAttribute("data-background-color");
        if (!color) {
          return false;
        }
        return { color };
      }
    }
  ],
  toDOM: (mark) => [
    "span",
    {
      "data-background-color": String(mark.attrs.color),
      style: `background-color: ${String(mark.attrs.color)}`
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

const dateMarkSpec: MarkSpec = {
  attrs: {
    date: {},
    displayText: {},
    hasTime: {}
  },
  inclusive: false,
  parseDOM: [
    {
      tag: "span[data-date]",
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) {
          return false;
        }
        const date = dom.getAttribute("data-date-value");
        const displayText = dom.getAttribute("data-date-display");
        const hasTime = dom.getAttribute("data-date-has-time");
        if (!date || !displayText) {
          return false;
        }
        return { 
          date, 
          displayText, 
          hasTime: hasTime === "true" 
        };
      }
    }
  ],
  toDOM: (mark) => [
    "span",
    {
      "data-date": "true",
      "data-date-value": String(mark.attrs.date),
      "data-date-display": String(mark.attrs.displayText),
      "data-date-has-time": String(mark.attrs.hasTime),
      class: "thortiq-date-pill"
    },
    0
  ]
};

const marks = basicSchema.spec.marks.append(
  OrderedMap.from({
    underline: underlineMarkSpec,
    strikethrough: strikethroughMarkSpec,
    textColor: textColorMarkSpec,
    backgroundColor: backgroundColorMarkSpec,
    wikilink: wikilinkMarkSpec,
    tag: tagMarkSpec,
    date: dateMarkSpec
  })
);

export const editorSchema = new Schema({
  nodes: basicSchema.spec.nodes,
  marks
});

export type EditorSchema = typeof editorSchema;
