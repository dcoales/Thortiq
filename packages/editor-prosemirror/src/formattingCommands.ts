import { setBlockType } from "prosemirror-commands";
import type { NodeType } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";

const HEADING_LEVELS = [1, 2, 3, 4, 5] as const;

export type HeadingLevel = (typeof HEADING_LEVELS)[number];

const clampHeadingLevel = (level: number): HeadingLevel => {
  if (level <= 1) {
    return 1;
  }
  if (level >= 5) {
    return 5;
  }
  return level as HeadingLevel;
};

const getHeadingNode = (state: EditorState): NodeType | null => {
  return state.schema.nodes.heading ?? null;
};

const getParagraphNode = (state: EditorState): NodeType | null => {
  return state.schema.nodes.paragraph ?? null;
};

const selectionCoversOnlyHeadingLevel = (state: EditorState, level: HeadingLevel): boolean => {
  const heading = getHeadingNode(state);
  if (!heading) {
    return false;
  }
  const { from, to } = state.selection;
  let encounteredTextblock = false;
  let allMatch = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isTextblock) {
      return;
    }
    encounteredTextblock = true;
    if (node.type !== heading || node.attrs.level !== level) {
      allMatch = false;
    }
  });
  return encounteredTextblock && allMatch;
};

export const getActiveHeadingLevel = (state: EditorState): HeadingLevel | null => {
  const heading = getHeadingNode(state);
  if (!heading) {
    return null;
  }
  const { $from } = state.selection;
  const parent = $from.parent;
  if (parent.type !== heading) {
    return null;
  }
  const levelValue = parent.attrs.level;
  if (typeof levelValue !== "number") {
    return null;
  }
  if (!HEADING_LEVELS.includes(levelValue as HeadingLevel)) {
    return null;
  }
  return levelValue as HeadingLevel;
};

export const createSetHeadingCommand = (level: HeadingLevel): Command => {
  const boundedLevel = clampHeadingLevel(level);
  return (state, dispatch, view) => {
    const heading = getHeadingNode(state);
    if (!heading) {
      return false;
    }
    const command = setBlockType(heading, { level: boundedLevel });
    return command(state, dispatch, view);
  };
};

export const createToggleHeadingCommand = (level: HeadingLevel): Command => {
  const boundedLevel = clampHeadingLevel(level);
  return (state, dispatch, view) => {
    const heading = getHeadingNode(state);
    const paragraph = getParagraphNode(state);
    if (!heading || !paragraph) {
      return false;
    }
    if (selectionCoversOnlyHeadingLevel(state, boundedLevel)) {
      const paragraphCommand = setBlockType(paragraph);
      return paragraphCommand(state, dispatch, view);
    }
    const headingCommand = setBlockType(heading, { level: boundedLevel });
    return headingCommand(state, dispatch, view);
  };
};

export const HEADING_LEVEL_OPTIONS: readonly HeadingLevel[] = HEADING_LEVELS;
