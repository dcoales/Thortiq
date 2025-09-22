import {
  createChildResolverFromMap,
  validateMirrorEdge,
  wouldCreateCycle
} from '../invariants';
import {createEdgeId, createNodeId} from '../ids';
import type {EdgeRecord, EdgeRole, NodeId} from '../types';

const now = new Date().toISOString();

const createEdge = (
  parentId: NodeId,
  childId: NodeId,
  role: EdgeRole = 'primary',
  ordinal = 0
): EdgeRecord => ({
  id: createEdgeId(),
  parentId,
  childId,
  role,
  collapsed: false,
  ordinal,
  createdAt: now,
  updatedAt: now
});

describe('wouldCreateCycle', () => {
  it('returns true when reparenting under a descendant', () => {
    const root = createNodeId();
    const child = createNodeId();
    const grandchild = createNodeId();

    const childMap = new Map<NodeId, readonly EdgeRecord[]>([
      [root, [createEdge(root, child)]],
      [child, [createEdge(child, grandchild)]]
    ]);

    const resolveChildren = createChildResolverFromMap(childMap);

    expect(wouldCreateCycle(resolveChildren, child, grandchild)).toBe(true);
  });

  it('returns false when moving to an unrelated branch', () => {
    const root = createNodeId();
    const childA = createNodeId();
    const childB = createNodeId();
    const grandchild = createNodeId();

    const childMap = new Map<NodeId, readonly EdgeRecord[]>([
      [root, [createEdge(root, childA), createEdge(root, childB)]],
      [childA, [createEdge(childA, grandchild)]]
    ]);

    const resolveChildren = createChildResolverFromMap(childMap);

    expect(wouldCreateCycle(resolveChildren, childA, childB)).toBe(false);
  });

  it('returns false when target parent is not in the subtree', () => {
    const root = createNodeId();
    const child = createNodeId();
    const unrelated = createNodeId();

    const childMap = new Map<NodeId, readonly EdgeRecord[]>([
      [root, [createEdge(root, child)]]
    ]);

    const resolveChildren = createChildResolverFromMap(childMap);

    expect(wouldCreateCycle(resolveChildren, child, unrelated)).toBe(false);
  });
});

describe('validateMirrorEdge', () => {
  it('flags mirrors without a primary edge', () => {
    const child = createNodeId();
    const parent = createNodeId();

    const edge = createEdge(parent, child, 'mirror');

    const result = validateMirrorEdge(edge, {
      hasPrimaryEdge: () => false
    });

    expect(result.isValid).toBe(false);
    expect(result.violations).toContain('missing-primary-edge');
  });

  it('flags mirrors that reference their parent node', () => {
    const node = createNodeId();
    const edge = createEdge(node, node, 'mirror');

    const result = validateMirrorEdge(edge, {
      hasPrimaryEdge: () => true
    });

    expect(result.isValid).toBe(false);
    expect(result.violations).toContain('mirror-self-parent');
  });

  it('returns valid for well-formed mirror edges', () => {
    const parent = createNodeId();
    const child = createNodeId();
    const edge = createEdge(parent, child, 'mirror');

    const result = validateMirrorEdge(edge, {
      hasPrimaryEdge: (nodeId) => nodeId === child
    });

    expect(result.isValid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

