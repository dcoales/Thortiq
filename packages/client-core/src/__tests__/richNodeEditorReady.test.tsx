import {render} from '@testing-library/react';
import React from 'react';

import {ThortiqProvider} from '../components/ThortiqProvider';
import {RichNodeEditor} from '../components/RichNodeEditor';
import {CommandBus} from '../commands/commandBus';
import {createThortiqDoc, ensureDocumentRoot, insertEdgeRecord, upsertNodeRecord} from '../yjs/doc';
import {createUndoManager} from '../yjs/undo';
import {createEdgeId, createNodeId} from '../ids';
import type {EdgeRecord, NodeRecord} from '../types';

const timestamp = () => new Date().toISOString();

describe('RichNodeEditor readiness scheduling', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('invokes onReady on the next animation frame tick', () => {
    jest.useFakeTimers();

    const doc = createThortiqDoc();
    const root = ensureDocumentRoot(doc);
    const undo = createUndoManager(doc);
    const bus = new CommandBus(doc, undo);

    const nodeId = createNodeId();
    const node: NodeRecord = {
      id: nodeId,
      html: '<p>Ready</p>',
      tags: [],
      attributes: {},
      createdAt: timestamp(),
      updatedAt: timestamp()
    };
    upsertNodeRecord(doc, node);

    const edge: EdgeRecord = {
      id: createEdgeId(),
      parentId: root.id,
      childId: nodeId,
      role: 'primary',
      collapsed: false,
      ordinal: 0,
      selected: false,
      createdAt: timestamp(),
      updatedAt: timestamp()
    };
    insertEdgeRecord(doc, edge);

    const originalRaf = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    const mockRaf: typeof window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
    const mockCancel: typeof window.cancelAnimationFrame = (handle) => {
      clearTimeout(handle);
    };
    window.requestAnimationFrame = mockRaf;
    window.cancelAnimationFrame = mockCancel;

    const onReady = jest.fn();

    const wrapper: React.FC<React.PropsWithChildren> = ({children}) => (
      <ThortiqProvider doc={doc} bus={bus}>
        {children}
      </ThortiqProvider>
    );

    const {unmount} = render(
      <RichNodeEditor
        nodeId={nodeId}
        edge={edge}
        typographyClassName="thq-node-text"
        onReady={onReady}
      />,
      {wrapper}
    );

    expect(onReady).not.toHaveBeenCalled();

    jest.runOnlyPendingTimers();
    expect(onReady).not.toHaveBeenCalled();

    jest.runOnlyPendingTimers();
    expect(onReady).toHaveBeenCalledTimes(1);

    unmount();
    jest.runOnlyPendingTimers();

    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancel;
  });
});
