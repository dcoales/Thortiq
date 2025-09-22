import type {EdgeRecord, NodeId, OutlineChildResolver} from './types';

export type MirrorInvariantViolation = 'mirror-self-parent' | 'missing-primary-edge';

export interface MirrorValidationOptions {
  readonly hasPrimaryEdge: (nodeId: NodeId) => boolean;
}

export interface MirrorValidationResult {
  readonly isValid: boolean;
  readonly violations: readonly MirrorInvariantViolation[];
}

export const validateMirrorEdge = (
  edge: EdgeRecord,
  options: MirrorValidationOptions
): MirrorValidationResult => {
  if (edge.role !== 'mirror') {
    return {isValid: true, violations: []};
  }

  const violations: MirrorInvariantViolation[] = [];

  if (edge.parentId === edge.childId) {
    violations.push('mirror-self-parent');
  }

  if (!options.hasPrimaryEdge(edge.childId)) {
    violations.push('missing-primary-edge');
  }

  return {
    isValid: violations.length === 0,
    violations
  };
};

export const wouldCreateCycle = (
  resolveChildren: OutlineChildResolver,
  movingNodeId: NodeId,
  targetParentId: NodeId
): boolean => {
  if (movingNodeId === targetParentId) {
    return true;
  }

  const visited = new Set<NodeId>();
  const stack: NodeId[] = [movingNodeId];

  while (stack.length > 0) {
    const current = stack.pop() as NodeId;

    if (current === targetParentId) {
      return true;
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    const children = resolveChildren(current);

    for (const edge of children) {
      stack.push(edge.childId);
    }
  }

  return false;
};

export const createChildResolverFromMap = (
  childMap: ReadonlyMap<NodeId, readonly EdgeRecord[]>
): OutlineChildResolver => {
  return (parentId: NodeId) => childMap.get(parentId) ?? [];
};

