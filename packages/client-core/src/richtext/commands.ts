import type {EditorState} from 'prosemirror-state';
import type {Command} from 'prosemirror-state';
import type {Doc as YDoc} from 'yjs';

import type {CommandBus} from '../commands/commandBus';
import type {EdgeRecord, EdgeId, NodeId} from '../types';
import {createEdgeId, createNodeId} from '../ids';
import {plainTextToHtml} from '../utils/text';
import {richTextDocToPlainText} from './serializers';

const timestamp = () => new Date().toISOString();

export interface CommandContext {
  readonly nodeId: NodeId;
  readonly edge: EdgeRecord | null;
  readonly doc: YDoc;
  readonly bus: CommandBus;
  readonly flushDebouncedCommit: () => void;
  readonly hasVisibleChildren: () => boolean;
  readonly onNodeCreated?: (details: {nodeId: NodeId; edgeId: EdgeId}) => void;
  readonly onTabCommand?: (
    edge: EdgeRecord | null,
    direction: 'indent' | 'outdent',
    caretPosition: number | null
  ) => boolean;
  readonly onBackspaceAtStart?: (edge: EdgeRecord) => boolean;
}

interface CreateNodeResult {
  readonly nodeId: NodeId;
  readonly edgeId: EdgeId;
}

const computeCaretOffset = (state: EditorState): number =>
  state.doc.textBetween(0, state.selection.from, '\n', '\n').length;

const createNodeRecordFromText = (text: string) => {
  const id = createNodeId();
  const now = timestamp();
  return {
    id,
    html: plainTextToHtml(text),
    tags: [],
    attributes: {},
    createdAt: now,
    updatedAt: now
  };
};

const insertNode = (
  context: CommandContext,
  parentId: NodeId,
  ordinal: number,
  text: string
): CreateNodeResult => {
  const node = createNodeRecordFromText(text);
  const now = timestamp();
  const edge: EdgeRecord = {
    id: createEdgeId(),
    parentId,
    childId: node.id,
    role: 'primary',
    collapsed: false,
    ordinal,
    selected: false,
    createdAt: now,
    updatedAt: now
  };

  context.bus.execute({kind: 'create-node', node, edge, initialText: text});
  context.onNodeCreated?.({nodeId: node.id, edgeId: edge.id});
  return {nodeId: node.id, edgeId: edge.id};
};

const createSiblingAbove = (context: CommandContext) => {
  if (!context.edge) {
    insertNode(context, context.nodeId, 0, '');
    return true;
  }
  insertNode(context, context.edge.parentId, context.edge.ordinal, '');
  return true;
};

const createSiblingBelow = (context: CommandContext, text: string) => {
  if (!context.edge) {
    insertNode(context, context.nodeId, 0, text);
    return true;
  }
  insertNode(context, context.edge.parentId, context.edge.ordinal + 1, text);
  return true;
};

const createChild = (context: CommandContext) => {
  insertNode(context, context.nodeId, 0, '');
  return true;
};

const handleSplitNode = (context: CommandContext, afterText: string) => {
  createSiblingBelow(context, afterText);
  return true;
};

export const createEnterCommand = (context: CommandContext): Command => (state, dispatch) => {
  if (!state.selection.empty) {
    return false;
  }

  const plainText = richTextDocToPlainText(state.doc);
  const caretOffset = computeCaretOffset(state);

  if (plainText.length === 0) {
    context.flushDebouncedCommit();
    return createSiblingBelow(context, '');
  }

  if (caretOffset === 0) {
    context.flushDebouncedCommit();
    return createSiblingAbove(context);
  }

  if (caretOffset === plainText.length) {
    context.flushDebouncedCommit();
    if (context.hasVisibleChildren()) {
      return createChild(context);
    }
    return createSiblingBelow(context, '');
  }

  if (!dispatch) {
    return false;
  }

  const parent = state.selection.$from.parent;
  const parentOffset = state.selection.$from.parentOffset;
  const deleteTo = state.selection.from + (parent.content.size - parentOffset);

  const afterText = plainText.slice(caretOffset);

  context.flushDebouncedCommit();

  if (deleteTo > state.selection.from) {
    const tr = state.tr.delete(state.selection.from, deleteTo);
    dispatch(tr);
  }

  return handleSplitNode(context, afterText);
};

export const createIndentCommand = (context: CommandContext): Command => (state) => {
  const caretOffset = computeCaretOffset(state);
  const handled = context.onTabCommand?.(context.edge ?? null, 'indent', caretOffset) ?? false;
  if (handled) {
    return true;
  }
  if (!context.edge) {
    return false;
  }
  context.flushDebouncedCommit();
  context.bus.execute({kind: 'indent-node', edgeId: context.edge.id, timestamp: timestamp()});
  return true;
};

export const createOutdentCommand = (context: CommandContext): Command => (state) => {
  const caretOffset = computeCaretOffset(state);
  const handled = context.onTabCommand?.(context.edge ?? null, 'outdent', caretOffset) ?? false;
  if (handled) {
    return true;
  }
  if (!context.edge) {
    return false;
  }
  context.flushDebouncedCommit();
  context.bus.execute({kind: 'outdent-node', edgeId: context.edge.id, timestamp: timestamp()});
  return true;
};

export const createBackspaceCommand = (context: CommandContext): Command => (state) => {
  if (!context.edge || !context.onBackspaceAtStart) {
    return false;
  }
  if (!state.selection.empty) {
    return false;
  }
  if (state.selection.$from.parentOffset !== 0) {
    return false;
  }
  context.flushDebouncedCommit();
  return context.onBackspaceAtStart(context.edge) ?? false;
};
