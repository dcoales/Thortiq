/**
 * Defines the shared ProseMirror schema used by Thortiq rich text editors.
 * The schema captures block structure (paragraphs, headings) and inline marks
 * required for wiki links, mirrors, tags, dates, and rich formatting.
 */
import type {MarkSpec, NodeSpec} from 'prosemirror-model';
import {Schema} from 'prosemirror-model';

const DATA_MARK_ATTRIBUTE = 'data-thortiq-mark';
const createMarkAttributes = (mark: string): Record<string, string> => ({
  [DATA_MARK_ATTRIBUTE]: mark
});

const paragraph: NodeSpec = {
  group: 'block',
  content: 'inline*',
  parseDOM: [{tag: 'p'}],
  toDOM: () => ['p', 0]
};

const headingLevels = [1, 2, 3, 4, 5] as const;

const heading: NodeSpec = {
  attrs: {
    level: {default: 1}
  },
  content: 'inline*',
  defining: true,
  group: 'block',
  parseDOM: headingLevels.map((level) => ({
    tag: `h${level}`,
    getAttrs: () => ({level})
  })),
  toDOM: (node) => {
    const rawLevel = typeof node.attrs.level === 'number' ? node.attrs.level : Number(node.attrs.level);
    const level = headingLevels.find((candidate) => candidate === rawLevel) ?? 1;
    return [`h${level}`, 0];
  }
};

const hardBreak: NodeSpec = {
  inline: true,
  group: 'inline',
  selectable: false,
  parseDOM: [{tag: 'br'}],
  toDOM: () => ['br']
};

const text: NodeSpec = {
  group: 'inline'
};

const strong: MarkSpec = {
  parseDOM: [
    {tag: 'strong'},
    {tag: 'b', getAttrs: () => ({})},
    {style: 'font-weight', getAttrs: (value) => (Number(value) >= 700 ? {} : false)}
  ],
  toDOM: () => ['strong', 0]
};

const emphasis: MarkSpec = {
  parseDOM: [{tag: 'em'}, {tag: 'i'}, {style: 'font-style=italic'}],
  toDOM: () => ['em', 0]
};

const underline: MarkSpec = {
  parseDOM: [
    {tag: 'u'},
    {
      style: 'text-decoration',
      getAttrs: (value) => (typeof value === 'string' && value.includes('underline') ? {} : false)
    }
  ],
  toDOM: () => ['u', 0]
};

const textColor: MarkSpec = {
  attrs: {
    color: {default: null},
    id: {default: null}
  },
  parseDOM: [
    {
      style: 'color',
      getAttrs: (value) => (typeof value === 'string' ? {color: value} : false)
    },
    {
      tag: 'span[data-thortiq-mark="textColor"]',
      getAttrs: (node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }
        const element = node;
        const color = element.getAttribute('data-color') ?? element.style.color ?? null;
        if (!color) {
          return false;
        }
        return {
          color,
          id: element.getAttribute('data-id') ?? null
        };
      }
    }
  ],
  toDOM: (mark) => {
    const attrs: Record<string, string> = {
      ...createMarkAttributes('textColor')
    };
    const color = typeof mark.attrs?.color === 'string' ? mark.attrs.color : null;
    const id = typeof mark.attrs?.id === 'string' ? mark.attrs.id : null;
    if (color) {
      attrs.style = `color: ${color}`;
      attrs['data-color'] = color;
    }
    if (id) {
      attrs['data-id'] = id;
    }
    return ['span', attrs, 0];
  }
};

const backgroundColor: MarkSpec = {
  attrs: {
    color: {default: null},
    id: {default: null}
  },
  parseDOM: [
    {
      style: 'background-color',
      getAttrs: (value) => (typeof value === 'string' ? {color: value} : false)
    },
    {
      tag: 'span[data-thortiq-mark="backgroundColor"]',
      getAttrs: (node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }
        const element = node;
        const color = element.getAttribute('data-color') ?? element.style.backgroundColor ?? null;
        if (!color) {
          return false;
        }
        return {
          color,
          id: element.getAttribute('data-id') ?? null
        };
      }
    }
  ],
  toDOM: (mark) => {
    const attrs: Record<string, string> = {
      ...createMarkAttributes('backgroundColor')
    };
    const color = typeof mark.attrs?.color === 'string' ? mark.attrs.color : null;
    const id = typeof mark.attrs?.id === 'string' ? mark.attrs.id : null;
    if (color) {
      attrs.style = `background-color: ${color}`;
      attrs['data-color'] = color;
    }
    if (id) {
      attrs['data-id'] = id;
    }
    return ['span', attrs, 0];
  }
};

const link: MarkSpec = {
  attrs: {
    href: {default: null},
    title: {default: null},
    id: {default: null},
    openInNewTab: {default: false}
  },
  inclusive: false,
  parseDOM: [
    {
      tag: 'a[href]',
      getAttrs: (node) => {
        if (!(node instanceof HTMLAnchorElement)) {
          return false;
        }
        const element = node;
        return {
          href: element.getAttribute('href') ?? null,
          title: element.getAttribute('title') ?? null,
          id: element.getAttribute('data-id') ?? null,
          openInNewTab: element.getAttribute('target') === '_blank'
        };
      }
    }
  ],
  toDOM: (mark) => {
    const attrs: Record<string, string> = {
      ...createMarkAttributes('link')
    };
    const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : null;
    const title = typeof mark.attrs?.title === 'string' ? mark.attrs.title : null;
    const id = typeof mark.attrs?.id === 'string' ? mark.attrs.id : null;
    const openInNewTab = mark.attrs?.openInNewTab === true;
    if (href) {
      attrs.href = href;
    }
    if (title) {
      attrs.title = title;
    }
    if (id) {
      attrs['data-id'] = id;
    }
    if (openInNewTab) {
      attrs.target = '_blank';
      attrs.rel = 'noopener noreferrer';
    }
    return ['a', attrs, 0];
  }
};

const tag: MarkSpec = {
  attrs: {
    id: {default: null},
    label: {default: null},
    kind: {default: null},
    color: {default: null}
  },
  inclusive: false,
  parseDOM: [{
    tag: 'span[data-thortiq-mark="tag"]',
    getAttrs: (node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      const element = node;
      return {
        id: element.getAttribute('data-tag-id') ?? null,
        label: element.getAttribute('data-tag-label') ?? element.textContent ?? null,
        kind: element.getAttribute('data-tag-kind') ?? null,
        color: element.getAttribute('data-tag-color') ?? null
      };
    }
  }],
  toDOM: (mark) => {
    const attrs: Record<string, string> = {
      ...createMarkAttributes('tag')
    };
    const id = typeof mark.attrs?.id === 'string' ? mark.attrs.id : null;
    const label = typeof mark.attrs?.label === 'string' ? mark.attrs.label : null;
    const kind = typeof mark.attrs?.kind === 'string' ? mark.attrs.kind : null;
    const color = typeof mark.attrs?.color === 'string' ? mark.attrs.color : null;
    if (id) {
      attrs['data-tag-id'] = id;
    }
    if (label) {
      attrs['data-tag-label'] = label;
    }
    if (kind) {
      attrs['data-tag-kind'] = kind;
    }
    if (color) {
      attrs['data-tag-color'] = color;
    }
    return ['span', attrs, 0];
  }
};

const mirror: MarkSpec = {
  attrs: {
    id: {default: null},
    nodeId: {default: null},
    edgeId: {default: null},
    label: {default: null}
  },
  inclusive: false,
  parseDOM: [{
    tag: 'span[data-thortiq-mark="mirror"]',
    getAttrs: (node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      const element = node;
      return {
        id: element.getAttribute('data-id') ?? null,
        nodeId: element.getAttribute('data-node-id') ?? null,
        edgeId: element.getAttribute('data-edge-id') ?? null,
        label: element.getAttribute('data-label') ?? element.textContent ?? null
      };
    }
  }],
  toDOM: (mark) => {
    const attrs: Record<string, string> = {
      ...createMarkAttributes('mirror')
    };
    const id = typeof mark.attrs?.id === 'string' ? mark.attrs.id : null;
    const nodeId = typeof mark.attrs?.nodeId === 'string' ? mark.attrs.nodeId : null;
    const edgeId = typeof mark.attrs?.edgeId === 'string' ? mark.attrs.edgeId : null;
    const label = typeof mark.attrs?.label === 'string' ? mark.attrs.label : null;
    if (id) {
      attrs['data-id'] = id;
    }
    if (nodeId) {
      attrs['data-node-id'] = nodeId;
    }
    if (edgeId) {
      attrs['data-edge-id'] = edgeId;
    }
    if (label) {
      attrs['data-label'] = label;
    }
    return ['span', attrs, 0];
  }
};

const dateMark: MarkSpec = {
  attrs: {
    id: {default: null},
    iso: {default: null},
    display: {default: null}
  },
  inclusive: false,
  parseDOM: [{
    tag: 'time[data-thortiq-mark="date"]',
    getAttrs: (node) => {
      if (!(node instanceof HTMLTimeElement)) {
        return false;
      }
      const element = node;
      return {
        id: element.getAttribute('data-id') ?? null,
        iso: element.getAttribute('datetime') ?? null,
        display: element.getAttribute('data-display') ?? element.textContent ?? null
      };
    }
  }],
  toDOM: (mark) => {
    const attrs: Record<string, string> = {
      ...createMarkAttributes('date')
    };
    const id = typeof mark.attrs?.id === 'string' ? mark.attrs.id : null;
    const iso = typeof mark.attrs?.iso === 'string' ? mark.attrs.iso : null;
    const display = typeof mark.attrs?.display === 'string' ? mark.attrs.display : null;
    if (id) {
      attrs['data-id'] = id;
    }
    if (iso) {
      attrs.datetime = iso;
    }
    if (display) {
      attrs['data-display'] = display;
    }
    return ['time', attrs, 0];
  }
};

const doc: NodeSpec = {content: 'block+'};

const nodes = {
  doc,
  paragraph,
  heading,
  hardBreak,
  text
};

const marks = {
  strong,
  emphasis,
  underline,
  textColor,
  backgroundColor,
  link,
  tag,
  mirror,
  date: dateMark
};

export const richTextSchema = new Schema({nodes, marks});

export const RICH_TEXT_HEADING_LEVELS = headingLevels;
