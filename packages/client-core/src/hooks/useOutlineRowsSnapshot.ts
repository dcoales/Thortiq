import {useMemo} from 'react';

import type {EdgeId} from '../types';
import {useYDoc} from './yDocContext';
import {useDocVersion} from './useDocVersion';
import {
  buildOutlineRowsSnapshot,
  type OutlineRowsSnapshot
} from '../virtualization/outlineRows';

export interface UseOutlineRowsOptions {
  readonly rootId: string;
  readonly collapsedEdgeIds?: ReadonlySet<EdgeId>;
  readonly initialDepth?: number;
}

export const useOutlineRowsSnapshot = (
  options: UseOutlineRowsOptions
): OutlineRowsSnapshot => {
  const doc = useYDoc();
  const version = useDocVersion();
  const collapsedIds = useMemo(() => {
    if (!options.collapsedEdgeIds) {
      return [] as EdgeId[];
    }
    return [...options.collapsedEdgeIds].sort();
  }, [options.collapsedEdgeIds]);

  const collapsedKey = useMemo(() => collapsedIds.join('|'), [collapsedIds]);
  const initialDepth = options.initialDepth ?? 0;

  return useMemo(() => {
    const collapsedSet = options.collapsedEdgeIds ? new Set<EdgeId>(collapsedIds) : undefined;
    return buildOutlineRowsSnapshot({
      doc,
      rootId: options.rootId,
      collapsedEdgeIds: collapsedSet,
      initialDepth
    });
  }, [collapsedIds, collapsedKey, doc, initialDepth, options.collapsedEdgeIds, options.rootId, version]);
};
