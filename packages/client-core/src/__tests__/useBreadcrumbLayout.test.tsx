import {renderHook} from '@testing-library/react';

import {
  createEdgeId,
  createNodeId,
  createThortiqDoc,
  ensureDocumentRoot,
  upsertNodeRecord
} from '..';
import type {NodeRecord} from '..';
import {useBreadcrumbLayout} from '../components/outline-pane/useBreadcrumbLayout';
import type {FocusPathEntry} from '../components/outline-pane/useOutlineFocusHistory';

describe('useBreadcrumbLayout', () => {
  const createNode = (id: string, html: string): NodeRecord => ({
    id,
    html,
    tags: [],
    attributes: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  it('returns descriptors with expected fallback labels', () => {
    const doc = createThortiqDoc();
    const root = ensureDocumentRoot(doc);

    const childA = createNodeId();
    const childB = createNodeId();

    upsertNodeRecord(doc, createNode(childA, 'Alpha'));
    upsertNodeRecord(doc, createNode(childB, ''));

    const focusPath: FocusPathEntry[] = [
      {nodeId: root.id, edgeId: null},
      {nodeId: childA, edgeId: createEdgeId()},
      {nodeId: childB, edgeId: createEdgeId()}
    ];

    const {result} = renderHook(() =>
      useBreadcrumbLayout({doc, docVersion: 0, focusPath, rootId: root.id})
    );

    const labels = result.current.descriptors.map((descriptor) => descriptor.label);
    expect(labels).toEqual(['Home', 'Alpha', 'Untitled']);
  });
});
