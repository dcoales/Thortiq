import {createEdgeId, createNodeId} from '../ids';
import type {EdgeRecord, NodeRecord} from '../types';
import {buildOutlineRowsSnapshot, type OutlineRowsSnapshot} from '../virtualization/outlineRows';
import {getOutlineEdgeResolver} from '../virtualization/edgeResolver';
import {DOCUMENT_ROOT_ID} from '../yjs/constants';
import {createThortiqDoc, insertEdgeRecord, upsertNodeRecord} from '../yjs/doc';

const now = new Date().toISOString();

const createNode = (overrides: Partial<NodeRecord> & Pick<NodeRecord, 'id'>): NodeRecord => {
  return {
    id: overrides.id,
    html: overrides.html ?? '<p>Node</p>',
    tags: overrides.tags ?? [],
    attributes: overrides.attributes ?? {},
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    task: overrides.task
  };
};

const createEdge = (overrides: Partial<EdgeRecord> & Pick<EdgeRecord, 'parentId' | 'childId'>): EdgeRecord => {
  return {
    id: overrides.id ?? createEdgeId(),
    parentId: overrides.parentId,
    childId: overrides.childId,
    role: overrides.role ?? 'primary',
    collapsed: overrides.collapsed ?? false,
    ordinal: overrides.ordinal ?? 0,
    selected: overrides.selected ?? false,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now
  };
};

describe('buildOutlineRowsSnapshot incremental resolver', () => {
  it('reindexes only mutated branches when rebuilding large snapshots', () => {
    const doc = createThortiqDoc();
    const branchCount = 50;
    const leavesPerBranch = 100;

    const branchIds: string[] = [];

    const resolver = getOutlineEdgeResolver(doc);

    for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
      const branchId = createNodeId();
      branchIds.push(branchId);
      upsertNodeRecord(doc, createNode({id: branchId, html: `<p>Branch ${branchIndex}</p>`}));
      insertEdgeRecord(
        doc,
        createEdge({
          parentId: DOCUMENT_ROOT_ID,
          childId: branchId,
          ordinal: branchIndex
        })
      );

      for (let leafIndex = 0; leafIndex < leavesPerBranch; leafIndex += 1) {
        const leafId = createNodeId();
        upsertNodeRecord(doc, createNode({id: leafId, html: `<p>${branchIndex}-${leafIndex}</p>`}));
        insertEdgeRecord(
          doc,
          createEdge({
            parentId: branchId,
            childId: leafId,
            ordinal: leafIndex
          })
        );
      }
    }

    const initialSnapshot: OutlineRowsSnapshot = buildOutlineRowsSnapshot({
      doc,
      rootId: DOCUMENT_ROOT_ID,
      initialDepth: 0
    });

    expect(initialSnapshot.rows.length).toBe(1 + branchCount + branchCount * leavesPerBranch);

    const baselineStats = resolver.getDebugStats();

    const targetBranchId = branchIds[Math.floor(branchCount / 2)];
    const untouchedBranchId = branchIds[0];

    const newLeafId = createNodeId();
    upsertNodeRecord(doc, createNode({id: newLeafId, html: '<p>New leaf</p>'}));
    insertEdgeRecord(
      doc,
      createEdge({
        parentId: targetBranchId,
        childId: newLeafId,
        ordinal: leavesPerBranch
      })
    );

    const updatedSnapshot: OutlineRowsSnapshot = buildOutlineRowsSnapshot({
      doc,
      rootId: DOCUMENT_ROOT_ID,
      initialDepth: 0
    });

    expect(updatedSnapshot.rows.length).toBe(initialSnapshot.rows.length + 1);

    const updatedStats = resolver.getDebugStats();
    const baselineTargetCount = baselineStats.perParentReindexCounts.get(targetBranchId) ?? 0;
    const updatedTargetCount = updatedStats.perParentReindexCounts.get(targetBranchId) ?? 0;
    const baselineUntouchedCount = baselineStats.perParentReindexCounts.get(untouchedBranchId) ?? 0;
    const updatedUntouchedCount = updatedStats.perParentReindexCounts.get(untouchedBranchId) ?? 0;

    expect(updatedTargetCount - baselineTargetCount).toBeGreaterThanOrEqual(1);
    expect(updatedUntouchedCount - baselineUntouchedCount).toBe(0);
  });

  it('preserves collapsed edge behaviour after resolver updates', () => {
    const doc = createThortiqDoc();
    getOutlineEdgeResolver(doc);
    const visibleBranch = createNodeId();
    const collapsedBranch = createNodeId();
    const collapsedChild = createNodeId();

    upsertNodeRecord(doc, createNode({id: visibleBranch, html: '<p>Visible</p>'}));
    upsertNodeRecord(doc, createNode({id: collapsedBranch, html: '<p>Collapsed</p>'}));
    upsertNodeRecord(doc, createNode({id: collapsedChild, html: '<p>Child</p>'}));

    const visibleEdge = createEdge({parentId: DOCUMENT_ROOT_ID, childId: visibleBranch, ordinal: 0});
    const collapsedEdge = createEdge({parentId: DOCUMENT_ROOT_ID, childId: collapsedBranch, ordinal: 1});
    insertEdgeRecord(doc, visibleEdge);
    insertEdgeRecord(doc, collapsedEdge);

    insertEdgeRecord(
      doc,
      createEdge({parentId: collapsedBranch, childId: collapsedChild, ordinal: 0})
    );

    const collapsedIds: ReadonlySet<string> = new Set([collapsedEdge.id]);

    const snapshot: OutlineRowsSnapshot = buildOutlineRowsSnapshot({
      doc,
      rootId: DOCUMENT_ROOT_ID,
      collapsedEdgeIds: collapsedIds,
      initialDepth: 0
    });

    expect(snapshot.rows.some((row) => row.node.id === collapsedChild)).toBe(false);

    const secondChild = createNodeId();
    upsertNodeRecord(doc, createNode({id: secondChild, html: '<p>Child 2</p>'}));
    insertEdgeRecord(
      doc,
      createEdge({parentId: collapsedBranch, childId: secondChild, ordinal: 1})
    );

    const updatedSnapshot: OutlineRowsSnapshot = buildOutlineRowsSnapshot({
      doc,
      rootId: DOCUMENT_ROOT_ID,
      collapsedEdgeIds: collapsedIds,
      initialDepth: 0
    });

    expect(updatedSnapshot.rows.some((row) => row.node.id === collapsedChild)).toBe(false);
    expect(updatedSnapshot.rows.some((row) => row.node.id === secondChild)).toBe(false);
  });
});
