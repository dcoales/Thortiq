import '@testing-library/jest-dom';
import {EditorState, TextSelection} from 'prosemirror-state';
import * as Y from 'yjs';

import {CommandBus} from '../commands/commandBus';
import {
  createIndentCommand,
  createEnterCommand,
  createBackspaceCommand,
  createOutdentCommand
} from '../richtext/commands';
import {plainTextToRichTextDoc} from '../richtext/serializers';
import {richTextSchema} from '../richtext/schema';
import {createEdgeId, createNodeId} from '../ids';
import type {CommandContext} from '../richtext/commands';
import type {EdgeRecord} from '../types';

const createBusDouble = () => {
  const execute = jest.fn();
  const bus = {
    execute,
    executeAll: jest.fn(),
    undo: jest.fn(),
    redo: jest.fn()
  } as unknown as CommandBus;
  return {bus, execute};
};

const createContext = (overrides: Partial<CommandContext> = {}): CommandContext => {
  const bus = overrides.bus ?? createBusDouble().bus;
  const doc = overrides.doc ?? new Y.Doc();
  const edge = overrides.edge ?? null;
  const nodeId = overrides.nodeId ?? createNodeId();
  const flushDebouncedCommit = overrides.flushDebouncedCommit ?? jest.fn();
  const hasVisibleChildren = overrides.hasVisibleChildren ?? (() => false);

  return {
    nodeId,
    edge,
    doc,
    bus,
    flushDebouncedCommit,
    hasVisibleChildren,
    onNodeCreated: overrides.onNodeCreated,
    onTabCommand: overrides.onTabCommand,
    onBackspaceAtStart: overrides.onBackspaceAtStart
  };
};

describe('richtext commands', () => {
  it('creates a sibling below when Enter is pressed on an empty node', () => {
    const {bus, execute} = createBusDouble();
    const context = createContext({bus});
    const command = createEnterCommand(context);
    const state = EditorState.create({schema: richTextSchema, doc: plainTextToRichTextDoc('')});

    const handled = command(state, () => undefined);

    expect(handled).toBe(true);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({kind: 'create-node'}));
  });

  it('delegates indent to CommandBus when outline does not override', () => {
    const edge: EdgeRecord = {
      id: createEdgeId(),
      parentId: createNodeId(),
      childId: createNodeId(),
      role: 'primary',
      collapsed: false,
      ordinal: 0,
      selected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const {bus, execute} = createBusDouble();
    const flush = jest.fn();
    const context = createContext({bus, edge, flushDebouncedCommit: flush});
    const command = createIndentCommand(context);
    const state = EditorState.create({schema: richTextSchema, doc: plainTextToRichTextDoc('alpha')});

    const handled = command(state);

    expect(handled).toBe(true);
    expect(flush).toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({kind: 'indent-node', edgeId: edge.id}));
  });

  it('does not indent when outline handler claims the event', () => {
    const {bus, execute} = createBusDouble();
    const context = createContext({
      bus,
      edge: {
        id: createEdgeId(),
        parentId: createNodeId(),
        childId: createNodeId(),
        role: 'primary',
        collapsed: false,
        ordinal: 0,
        selected: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      onTabCommand: () => true
    });
    const command = createIndentCommand(context);
    const state = EditorState.create({schema: richTextSchema, doc: plainTextToRichTextDoc('beta')});

    const handled = command(state);

    expect(handled).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it('delegates outdent to CommandBus when no outline override is present', () => {
    const edge: EdgeRecord = {
      id: createEdgeId(),
      parentId: createNodeId(),
      childId: createNodeId(),
      role: 'primary',
      collapsed: false,
      ordinal: 0,
      selected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const {bus, execute} = createBusDouble();
    const context = createContext({bus, edge});
    const command = createOutdentCommand(context);
    const state = EditorState.create({schema: richTextSchema, doc: plainTextToRichTextDoc('beta')});

    const handled = command(state);

    expect(handled).toBe(true);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({kind: 'outdent-node', edgeId: edge.id}));
  });

  it('calls onBackspaceAtStart when the caret is at column 0', () => {
    const edge: EdgeRecord = {
      id: createEdgeId(),
      parentId: createNodeId(),
      childId: createNodeId(),
      role: 'primary',
      collapsed: false,
      ordinal: 0,
      selected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const spy = jest.fn().mockReturnValue(true);
    const context = createContext({edge, onBackspaceAtStart: spy});
    const command = createBackspaceCommand(context);
    const state = EditorState.create({schema: richTextSchema, doc: plainTextToRichTextDoc('gamma')});
    const sel = TextSelection.create(state.doc, 1);
    const nextState = state.apply(state.tr.setSelection(sel));

    const handled = command(nextState);

    expect(handled).toBe(true);
    expect(spy).toHaveBeenCalledWith(edge);
  });
});
