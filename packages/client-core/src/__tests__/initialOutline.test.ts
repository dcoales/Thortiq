import {
  bootstrapInitialOutline,
  createEdgeId,
  createNodeId,
  createThortiqDoc,
  ensureDocumentRoot,
  getDefaultSeedTitles,
  initializeCollections,
  insertEdgeRecord,
  upsertNodeRecord
} from '..';
import {DOCUMENT_ROOT_ID} from '../yjs/constants';

const fixedNow = () => '2024-01-01T00:00:00.000Z';

describe('bootstrapInitialOutline', () => {
  test('seeds default outline nodes when the root has no children', () => {
    const doc = createThortiqDoc();
    const {root, seededNodeIds} = bootstrapInitialOutline(doc, {now: fixedNow});

    expect(root.id).toBe(DOCUMENT_ROOT_ID);
    expect(seededNodeIds).toHaveLength(getDefaultSeedTitles().length);

    const {nodes, edges} = initializeCollections(doc);
    const rootEdges = edges.get(root.id);
    expect(rootEdges?.length).toBe(getDefaultSeedTitles().length);

    const seededTitles = rootEdges?.toArray().map((edge) => nodes.get(edge.childId)?.html) ?? [];
    expect(seededTitles).toEqual(getDefaultSeedTitles());
  });

  test('does not create additional children when rerun on a seeded document', () => {
    const doc = createThortiqDoc();
    bootstrapInitialOutline(doc, {now: fixedNow});

    const rerun = bootstrapInitialOutline(doc, {now: fixedNow});
    expect(rerun.seededNodeIds).toHaveLength(0);

    const {edges} = initializeCollections(doc);
    const rootEdges = edges.get(DOCUMENT_ROOT_ID);
    expect(rootEdges?.length).toBe(getDefaultSeedTitles().length);
  });

  test('honors custom seed titles when provided', () => {
    const doc = createThortiqDoc();
    const seeds = ['One', 'Two'];
    const {seededNodeIds} = bootstrapInitialOutline(doc, {seedTitles: seeds, now: fixedNow});

    expect(seededNodeIds).toHaveLength(seeds.length);

    const {nodes, edges} = initializeCollections(doc);
    const rootEdges = edges.get(DOCUMENT_ROOT_ID);
    expect(rootEdges?.length).toBe(seeds.length);

    const seededTitles = rootEdges?.toArray().map((edge) => nodes.get(edge.childId)?.html) ?? [];
    expect(seededTitles).toEqual(seeds);
  });

  test('respects existing children under the canonical root', () => {
    const doc = createThortiqDoc();
    const root = ensureDocumentRoot(doc);
    const childId = createNodeId();
    const existingEdgeId = createEdgeId();

    upsertNodeRecord(doc, {
      id: childId,
      html: 'Existing child',
      tags: [],
      attributes: {},
      createdAt: fixedNow(),
      updatedAt: fixedNow()
    });

    insertEdgeRecord(doc, {
      id: existingEdgeId,
      parentId: root.id,
      childId,
      role: 'primary',
      collapsed: false,
      ordinal: 0,
      selected: false,
      createdAt: fixedNow(),
      updatedAt: fixedNow()
    });

    const result = bootstrapInitialOutline(doc, {now: fixedNow});
    expect(result.seededNodeIds).toHaveLength(0);

    const {edges} = initializeCollections(doc);
    const rootEdges = edges.get(root.id);
    expect(rootEdges?.length).toBe(1);
  });
});
