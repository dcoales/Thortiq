import { setBlockType, toggleMark } from "prosemirror-commands";
import type { Mark, NodeType } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";

const HEADING_LEVELS = [1, 2, 3, 4, 5] as const;

export type HeadingLevel = (typeof HEADING_LEVELS)[number];

const isTruthy = <T>(value: T | null | undefined): value is T => Boolean(value);

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

const createToggleMarkCommand = (markName: string): Command => {
  return (state, dispatch, view) => {
    const markType = state.schema.marks[markName];
    if (!markType) {
      return false;
    }
    return toggleMark(markType)(state, dispatch, view);
  };
};

const CLEARABLE_MARK_NAMES = ["strong", "em", "underline", "textColor", "backgroundColor"] as const;

const normalizeColor = (value: string): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
};

const replaceStoredMark = (state: EditorState, markTypeName: string, mark: Mark | null): unknown[] => {
  const source = state.storedMarks ?? state.selection.$from.marks();
  const filtered = source.filter((item) => item.type.name !== markTypeName);
  if (!mark) {
    return [...filtered];
  }
  return [...filtered, mark];
};

const createSetColorCommand = (markName: "textColor" | "backgroundColor") => {
  return (color: string): Command => {
    const normalized = normalizeColor(color);
    if (!normalized) {
      return () => false;
    }
    return (state, dispatch) => {
      const markType = state.schema.marks[markName];
      if (!markType) {
        return false;
      }
      const { from, to, empty } = state.selection;
      let transaction = state.tr;
      const attrs = { color: normalized };
      const mark = markType.create(attrs);

      if (empty) {
        const nextMarks = replaceStoredMark(state, markType.name, mark);
        type SetStoredMarksArg = Parameters<typeof transaction.setStoredMarks>[0];
        transaction.setStoredMarks((nextMarks.length > 0 ? nextMarks : null) as unknown as SetStoredMarksArg);
      } else {
        type RemoveMarkArg = Parameters<typeof transaction.removeMark>[2];
        transaction.removeMark(from, to, markType as unknown as RemoveMarkArg);
        type AddMarkArg = Parameters<typeof transaction.addMark>[2];
        transaction.addMark(from, to, mark as unknown as AddMarkArg);
      }

      if (!dispatch) {
        return true;
      }
      dispatch(transaction);
      return true;
    };
  };
};

const createClearColorCommand = (markName: "textColor" | "backgroundColor"): Command => {
  return (state, dispatch) => {
    const markType = state.schema.marks[markName];
    if (!markType) {
      return false;
    }
    const { from, to, empty } = state.selection;
    let transaction = state.tr;
    let changed = false;

    type RangeHasMarkArg = Parameters<typeof state.doc.rangeHasMark>[2];
    type RemoveMarkArg = Parameters<typeof transaction.removeMark>[2];
    if (!empty && state.doc.rangeHasMark(from, to, markType as unknown as RangeHasMarkArg)) {
      transaction.removeMark(from, to, markType as unknown as RemoveMarkArg);
      changed = true;
    }

    const currentStoredMarks = state.storedMarks ?? state.selection.$from.marks();
    const hadStoredMark = currentStoredMarks.some((item) => item.type === markType);
    const nextStoredMarks = hadStoredMark ? replaceStoredMark(state, markType.name, null) : currentStoredMarks;
    if (hadStoredMark) {
      type SetStoredMarksArg = Parameters<typeof transaction.setStoredMarks>[0];
      transaction.setStoredMarks((nextStoredMarks.length > 0 ? nextStoredMarks : null) as unknown as SetStoredMarksArg);
      changed = true;
    }

    if (!changed) {
      return false;
    }

    if (dispatch) {
      dispatch(transaction);
    }
    return true;
  };
};

export const clearInlineFormattingCommand: Command = (state, dispatch) => {
  const markTypes = CLEARABLE_MARK_NAMES.map((name) => state.schema.marks[name]).filter(isTruthy);
  if (markTypes.length === 0) {
    return false;
  }

  const { from, to, empty } = state.selection;
  let tr = state.tr;
  let changed = false;
  type RangeHasMarkArg = Parameters<typeof state.doc.rangeHasMark>[2];
  type RemoveMarkArg = Parameters<typeof tr.removeMark>[2];

  for (const markType of markTypes) {
    if (state.doc.rangeHasMark(from, to, markType as unknown as RangeHasMarkArg)) {
      tr.removeMark(from, to, markType as unknown as RemoveMarkArg);
      changed = true;
    }
  }

  if (empty) {
    const storedMarksSource: readonly Mark[] =
      state.storedMarks ?? state.selection.$from.marks();
    if (storedMarksSource.length > 0) {
      const markTypeSet = new Set(markTypes);
      const filtered = storedMarksSource.filter((mark) => !markTypeSet.has(mark.type));
      if (filtered.length !== storedMarksSource.length) {
        type SetStoredMarksArg = Parameters<typeof tr.setStoredMarks>[0];
        tr.setStoredMarks((filtered.length > 0 ? filtered : null) as unknown as SetStoredMarksArg);
        changed = true;
      }
    }
  }

  if (!changed) {
    return false;
  }

  if (dispatch) {
    dispatch(tr);
  }
  return true;
};

export const toggleBoldCommand = createToggleMarkCommand("strong");
export const toggleItalicCommand = createToggleMarkCommand("em");
export const toggleUnderlineCommand = createToggleMarkCommand("underline");
export const setTextColorCommand = createSetColorCommand("textColor");
export const setBackgroundColorCommand = createSetColorCommand("backgroundColor");
export const clearTextColorCommand = createClearColorCommand("textColor");
export const clearBackgroundColorCommand = createClearColorCommand("backgroundColor");
export const HEADING_LEVEL_OPTIONS: readonly HeadingLevel[] = HEADING_LEVELS;
