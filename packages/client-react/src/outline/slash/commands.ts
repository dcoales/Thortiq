import type { OutlineDoc, NodeId } from "@thortiq/client-core";
import {
  getInboxNodeId,
  getJournalNodeId,
  setInboxNodeId,
  setJournalNodeId,
  clearNodeFormatting,
  setNodeHeadingLevel
} from "@thortiq/client-core";

export interface SlashExecutionContext {
  readonly outline: OutlineDoc;
  readonly origin: unknown;
  readonly nodeIds: readonly NodeId[];
  readonly helpers: {
    readonly insertPlainText: (text: string) => boolean;
    readonly insertDatePill: (date: Date) => boolean;
    readonly requestMoveDialog: () => void;
    readonly requestMirrorDialog: () => void;
    readonly requestMoveToDate: () => void;
    readonly requestGoToToday: () => void;
    readonly toggleTask: () => void;
    readonly setHeadingInEditor: (level: 1 | 2 | 3 | 4 | 5) => boolean;
  };
}

export interface SlashCommandDescriptor {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly run: (ctx: SlashExecutionContext) => boolean | void;
}

const matchSubsequence = (label: string, query: string): boolean => {
  const a = label.toLowerCase();
  const b = query.toLowerCase();
  let i = 0;
  for (let j = 0; j < a.length && i < b.length; j += 1) {
    if (a[j] === b[i]) {
      i += 1;
    }
  }
  return i === b.length;
};

export const filterSlashCommands = (
  commands: readonly SlashCommandDescriptor[],
  query: string
): readonly SlashCommandDescriptor[] => {
  const normalized = query.trim();
  if (normalized.length === 0) {
    return commands.slice(0, 25);
  }
  const matches = commands.filter((c) => matchSubsequence(c.label, normalized));
  return matches.slice(0, 25);
};

export const buildSlashCommands = (): readonly SlashCommandDescriptor[] => {
  const items: SlashCommandDescriptor[] = [];

  items.push({ id: "h1", label: "H1", run: ({ outline, origin, nodeIds, helpers }) => {
    if (nodeIds.length > 0) {
      setNodeHeadingLevel(outline, nodeIds, 1, origin);
      return true;
    }
    return helpers.setHeadingInEditor(1);
  }});
  items.push({ id: "h2", label: "H2", run: ({ outline, origin, nodeIds, helpers }) => {
    if (nodeIds.length > 0) {
      setNodeHeadingLevel(outline, nodeIds, 2, origin);
      return true;
    }
    return helpers.setHeadingInEditor(2);
  }});
  items.push({ id: "h3", label: "H3", run: ({ outline, origin, nodeIds, helpers }) => {
    if (nodeIds.length > 0) {
      setNodeHeadingLevel(outline, nodeIds, 3, origin);
      return true;
    }
    return helpers.setHeadingInEditor(3);
  }});
  items.push({ id: "h4", label: "H4", run: ({ outline, origin, nodeIds, helpers }) => {
    if (nodeIds.length > 0) {
      setNodeHeadingLevel(outline, nodeIds, 4, origin);
      return true;
    }
    return helpers.setHeadingInEditor(4);
  }});
  items.push({ id: "h5", label: "H5", run: ({ outline, origin, nodeIds, helpers }) => {
    if (nodeIds.length > 0) {
      setNodeHeadingLevel(outline, nodeIds, 5, origin);
      return true;
    }
    return helpers.setHeadingInEditor(5);
  }});

  items.push({ id: "bullet", label: "Bullet", run: ({ outline, origin, nodeIds }) => {
    if (nodeIds.length === 0) {
      return false;
    }
    clearNodeFormatting(outline, nodeIds, origin);
    return true;
  }});

  items.push({ id: "task", label: "Task", run: ({ helpers }) => helpers.toggleTask() });

  items.push({ id: "inbox", label: "Inbox", run: ({ outline, origin, nodeIds }) => {
    if (nodeIds.length !== 1) return false;
    const target = nodeIds[0];
    const current = getInboxNodeId(outline);
    if (current && current !== target) {
      // Adapter should confirm; here we replace directly for slash simplicity.
    }
    setInboxNodeId(outline, target, origin);
    return true;
  }});

  items.push({ id: "journal", label: "Journal", run: ({ outline, origin, nodeIds }) => {
    if (nodeIds.length !== 1) return false;
    const target = nodeIds[0];
    const current = getJournalNodeId(outline);
    if (current && current !== target) {
      // Adapter should confirm; replace directly here.
    }
    setJournalNodeId(outline, target, origin);
    return true;
  }});

  items.push({ id: "moveTo", label: "Move To", hint: "Open move dialog", run: ({ helpers }) => {
    helpers.requestMoveDialog();
    return true;
  }});
  items.push({ id: "mirrorTo", label: "Mirror To", hint: "Open mirror dialog", run: ({ helpers }) => {
    helpers.requestMirrorDialog();
    return true;
  }});

  items.push({ id: "time", label: "Time", run: ({ helpers }) => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    return helpers.insertPlainText(`${hh}:${mm} `);
  }});

  items.push({ id: "today", label: "Today", run: ({ helpers }) => {
    const today = new Date();
    return helpers.insertDatePill(today);
  }});

  items.push({ id: "moveToDate", label: "Move To Date", run: ({ helpers }) => {
    helpers.requestMoveToDate();
    return true;
  }});

  items.push({ id: "goToToday", label: "Go to today", run: ({ helpers }) => {
    helpers.requestGoToToday();
    return true;
  }});

  return items;
};


