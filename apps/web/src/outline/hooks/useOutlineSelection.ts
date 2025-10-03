import { useCallback, useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { EdgeId, OutlineDoc } from "@thortiq/client-core";
import {
  indentEdges,
  insertChild,
  insertSiblingBelow,
  outdentEdges,
  createDeleteEdgesPlan,
  deleteEdges,
  toggleTodoDoneCommand
} from "@thortiq/outline-commands";
import type { OutlineSelectionAdapter } from "@thortiq/editor-prosemirror";

import type { OutlineRow, SelectionRange } from "../types";

const createSelectionRange = (
  selection: { anchorEdgeId: EdgeId; headEdgeId: EdgeId } | undefined
): SelectionRange | null => {
  if (!selection) {
    return null;
  }
  return {
    anchorEdgeId: selection.anchorEdgeId,
    focusEdgeId: selection.headEdgeId
  } satisfies SelectionRange;
};

const findParentRow = (rows: OutlineRow[], row: OutlineRow): OutlineRow | undefined => {
  const parentDepth = row.treeDepth - 1;
  if (parentDepth < 0) {
    return undefined;
  }
  for (let index = rows.indexOf(row) - 1; index >= 0; index -= 1) {
    const candidate = rows[index];
    if (!candidate) {
      continue;
    }
    if (candidate.treeDepth === parentDepth) {
      return candidate;
    }
    if (candidate.treeDepth < parentDepth) {
      break;
    }
  }
  return undefined;
};

const findFirstChildRow = (rows: OutlineRow[], row: OutlineRow): OutlineRow | undefined => {
  const childDepth = row.treeDepth + 1;
  for (let index = rows.indexOf(row) + 1; index < rows.length; index += 1) {
    const candidate = rows[index];
    if (!candidate) {
      continue;
    }
    if (candidate.treeDepth === childDepth) {
      return candidate;
    }
    if (candidate.treeDepth <= row.treeDepth) {
      break;
    }
  }
  return undefined;
};

interface SelectionSnapshot {
  primaryEdgeId: EdgeId | null;
  orderedEdgeIds: readonly EdgeId[];
}

export interface OutlineSelectionState {
  readonly selectionRange: SelectionRange | null;
  readonly selectionHighlightActive: boolean;
  readonly selectedEdgeIds: ReadonlySet<EdgeId>;
  readonly orderedSelectedEdgeIds: readonly EdgeId[];
  readonly selectedIndex: number;
  readonly selectedRow: OutlineRow | null;
  readonly adjacentEdgeIds: { previous: EdgeId | null; next: EdgeId | null };
  readonly activeRowSummary: {
    readonly hasChildren: boolean;
    readonly collapsed: boolean;
    readonly visibleChildCount: number;
  } | null;
  readonly selectionAdapter: OutlineSelectionAdapter;
  readonly selectionSnapshotRef: React.MutableRefObject<SelectionSnapshot>;
  readonly handleDeleteSelection: () => boolean;
  readonly handleKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

interface UseOutlineSelectionParams {
  readonly rows: OutlineRow[];
  readonly edgeIndexMap: ReadonlyMap<EdgeId, number>;
  readonly paneSelectionRange: { anchorEdgeId: EdgeId; headEdgeId: EdgeId } | undefined;
  readonly selectedEdgeId: EdgeId | null;
  readonly outline: OutlineDoc;
  readonly localOrigin: unknown;
  readonly setSelectionRange: (range: SelectionRange | null) => void;
  readonly setSelectedEdgeId: (edgeId: EdgeId | null, options?: { preserveRange?: boolean; cursor?: unknown }) => void;
  readonly setCollapsed: (edgeId: EdgeId, collapsed: boolean) => void;
}

export const useOutlineSelection = ({
  rows,
  edgeIndexMap,
  paneSelectionRange,
  selectedEdgeId,
  outline,
  localOrigin,
  setSelectionRange,
  setSelectedEdgeId,
  setCollapsed
}: UseOutlineSelectionParams): OutlineSelectionState => {
  const selectionRange = useMemo(() => createSelectionRange(paneSelectionRange), [paneSelectionRange]);
  const selectionHighlightActive = Boolean(selectionRange);

  const selectedIndex = useMemo(() => {
    if (!selectedEdgeId) {
      return -1;
    }
    return rows.findIndex((row) => row.edgeId === selectedEdgeId);
  }, [rows, selectedEdgeId]);

  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] ?? null : null;

  const selectedEdgeIds = useMemo(() => {
    if (selectionRange) {
      const anchorIndex = edgeIndexMap.get(selectionRange.anchorEdgeId);
      const focusIndex = edgeIndexMap.get(selectionRange.focusEdgeId);
      if (anchorIndex !== undefined && focusIndex !== undefined) {
        const selection = new Set<EdgeId>();
        const start = Math.min(anchorIndex, focusIndex);
        const end = Math.max(anchorIndex, focusIndex);
        for (let index = start; index <= end; index += 1) {
          const row = rows[index];
          if (row) {
            selection.add(row.edgeId);
          }
        }
        return selection as ReadonlySet<EdgeId>;
      }
    }
    return selectedEdgeId ? new Set<EdgeId>([selectedEdgeId]) : new Set<EdgeId>();
  }, [edgeIndexMap, rows, selectedEdgeId, selectionRange]);

  const orderedSelectedEdgeIds = useMemo(() => {
    if (selectedEdgeIds.size === 0) {
      return [] as EdgeId[];
    }
    return rows
      .filter((row) => selectedEdgeIds.has(row.edgeId))
      .map((row) => row.edgeId);
  }, [rows, selectedEdgeIds]);

  const adjacentEdgeIds = useMemo(() => {
    if (selectedIndex < 0) {
      return { previous: null as EdgeId | null, next: null as EdgeId | null };
    }
    const previous = selectedIndex > 0 ? rows[selectedIndex - 1]?.edgeId ?? null : null;
    const next = selectedIndex < rows.length - 1 ? rows[selectedIndex + 1]?.edgeId ?? null : null;
    return { previous, next };
  }, [rows, selectedIndex]);

  const activeRowSummary = useMemo(() => {
    if (!selectedRow) {
      return null;
    }
    const baseDepth = selectedRow.treeDepth;
    let visibleChildCount = 0;
    for (let index = selectedIndex + 1; index < rows.length; index += 1) {
      const candidate = rows[index];
      if (!candidate) {
        break;
      }
      if (candidate.treeDepth <= baseDepth) {
        break;
      }
      if (candidate.treeDepth === baseDepth + 1) {
        visibleChildCount += 1;
      }
    }
    return {
      hasChildren: selectedRow.hasChildren,
      collapsed: selectedRow.collapsed,
      visibleChildCount
    };
  }, [rows, selectedIndex, selectedRow]);

  const selectionSnapshotRef = useRef<SelectionSnapshot>({
    primaryEdgeId: selectedEdgeId,
    orderedEdgeIds: orderedSelectedEdgeIds
  });

  useEffect(() => {
    selectionSnapshotRef.current = {
      primaryEdgeId: selectedEdgeId,
      orderedEdgeIds: orderedSelectedEdgeIds
    };
  }, [orderedSelectedEdgeIds, selectedEdgeId]);

  useEffect(() => {
    if (!selectionRange) {
      return;
    }
    if (
      !edgeIndexMap.has(selectionRange.anchorEdgeId)
      || !edgeIndexMap.has(selectionRange.focusEdgeId)
    ) {
      setSelectionRange(null);
    }
  }, [edgeIndexMap, selectionRange, setSelectionRange]);

  const selectionAdapter = useMemo<OutlineSelectionAdapter>(() => ({
    getPrimaryEdgeId: () => selectionSnapshotRef.current.primaryEdgeId ?? null,
    getOrderedEdgeIds: () => [...selectionSnapshotRef.current.orderedEdgeIds],
    setPrimaryEdgeId: (edgeId, options) => {
      setSelectedEdgeId(edgeId, options?.cursor ? { cursor: options.cursor } : undefined);
    },
    clearRange: () => {
      setSelectionRange(null);
    }
  }), [setSelectionRange, setSelectedEdgeId]);

  const handleDeleteSelection = useCallback((): boolean => {
    const edgeIds = orderedSelectedEdgeIds;
    if (edgeIds.length === 0) {
      return false;
    }

    const plan = createDeleteEdgesPlan(outline, edgeIds);
    if (!plan || plan.removalOrder.length === 0) {
      return false;
    }

    if (plan.removalOrder.length > 30) {
      const confirmFn =
        typeof window !== "undefined" && typeof window.confirm === "function"
          ? window.confirm.bind(window)
          : null;
      const message = plan.removalOrder.length === 1
        ? "Delete the selected node? This also removes its descendants."
        : `Delete ${plan.removalOrder.length} nodes? This also removes their descendants.`;
      if (confirmFn && !confirmFn(message)) {
        return false;
      }
    }

    const result = deleteEdges({ outline, origin: localOrigin }, plan);
    const nextEdgeId = result.nextEdgeId;
    if (nextEdgeId) {
      setSelectedEdgeId(nextEdgeId);
    } else {
      setSelectedEdgeId(null);
    }
    return true;
  }, [localOrigin, orderedSelectedEdgeIds, outline, setSelectedEdgeId]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!rows.length || selectedIndex === -1 || !selectedEdgeId) {
        return;
      }

      const row = rows[selectedIndex];
      if (!row) {
        return;
      }

      if (event.key === "ArrowDown") {
        setSelectionRange(null);
        event.preventDefault();
        const next = Math.min(selectedIndex + 1, rows.length - 1);
        setSelectedEdgeId(rows[next]?.edgeId ?? selectedEdgeId);
        return;
      }

      if (event.key === "ArrowUp") {
        setSelectionRange(null);
        event.preventDefault();
        const next = Math.max(selectedIndex - 1, 0);
        setSelectedEdgeId(rows[next]?.edgeId ?? selectedEdgeId);
        return;
      }

      if (event.key === "Enter" && event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        const targets = orderedSelectedEdgeIds.length > 0 ? orderedSelectedEdgeIds : [row.edgeId];
        toggleTodoDoneCommand({ outline, origin: localOrigin }, targets);
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        setSelectionRange(null);
        event.preventDefault();
        const result = insertSiblingBelow({ outline, origin: localOrigin }, row.edgeId);
        setSelectedEdgeId(result.edgeId);
        return;
      }

      if (event.key === "Enter" && event.shiftKey) {
        setSelectionRange(null);
        event.preventDefault();
        const result = insertChild({ outline, origin: localOrigin }, row.edgeId);
        setSelectedEdgeId(result.edgeId);
        return;
      }

      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        const orderedEdgeIds = rows
          .filter((candidate) => selectedEdgeIds.has(candidate.edgeId))
          .map((candidate) => candidate.edgeId);
        const edgeIdsToIndent = orderedEdgeIds.length > 0 ? orderedEdgeIds : [row.edgeId];
        const preserveRange = edgeIdsToIndent.length > 1;
        let anchorEdgeId: EdgeId | null = null;
        let focusEdgeId: EdgeId | null = null;
        if (preserveRange) {
          anchorEdgeId = edgeIdsToIndent[0] ?? null;
          focusEdgeId = edgeIdsToIndent[edgeIdsToIndent.length - 1] ?? null;
        }
        const result = indentEdges(
          { outline, origin: localOrigin },
          [...edgeIdsToIndent].reverse()
        );
        if (result) {
          if (preserveRange && anchorEdgeId && focusEdgeId) {
            setSelectionRange({ anchorEdgeId, focusEdgeId });
            setSelectedEdgeId(row.edgeId, { preserveRange: true });
          } else {
            setSelectionRange(null);
            setSelectedEdgeId(row.edgeId);
          }
        }
        return;
      }

      if (event.key === "Tab" && event.shiftKey) {
        event.preventDefault();
        const orderedEdgeIds = rows
          .filter((candidate) => selectedEdgeIds.has(candidate.edgeId))
          .map((candidate) => candidate.edgeId);
        const edgeIdsToOutdent = orderedEdgeIds.length > 0 ? orderedEdgeIds : [row.edgeId];
        const preserveRange = edgeIdsToOutdent.length > 1;
        let anchorEdgeId: EdgeId | null = null;
        let focusEdgeId: EdgeId | null = null;
        if (preserveRange) {
          anchorEdgeId = edgeIdsToOutdent[0] ?? null;
          focusEdgeId = edgeIdsToOutdent[edgeIdsToOutdent.length - 1] ?? null;
        }
        const result = outdentEdges({ outline, origin: localOrigin }, edgeIdsToOutdent);
        if (result) {
          if (preserveRange && anchorEdgeId && focusEdgeId) {
            setSelectionRange({ anchorEdgeId, focusEdgeId });
            setSelectedEdgeId(row.edgeId, { preserveRange: true });
          } else {
            setSelectionRange(null);
            setSelectedEdgeId(row.edgeId);
          }
        }
        return;
      }

      if (event.key === "ArrowLeft") {
        setSelectionRange(null);
        event.preventDefault();
        if (row.hasChildren && !row.collapsed) {
          setCollapsed(row.edgeId, true);
          return;
        }
        const parentRow = findParentRow(rows, row);
        if (parentRow) {
          setSelectedEdgeId(parentRow.edgeId);
        }
        return;
      }

      if (event.key === "ArrowRight") {
        setSelectionRange(null);
        event.preventDefault();
        if (row.collapsed && row.hasChildren) {
          setCollapsed(row.edgeId, false);
          return;
        }
        const childRow = findFirstChildRow(rows, row);
        if (childRow) {
          setSelectedEdgeId(childRow.edgeId);
        }
      }
    },
    [localOrigin, orderedSelectedEdgeIds, outline, rows, selectedEdgeId, selectedEdgeIds, selectedIndex, setCollapsed, setSelectedEdgeId, setSelectionRange]
  );

  return {
    selectionRange,
    selectionHighlightActive,
    selectedEdgeIds,
    orderedSelectedEdgeIds,
    selectedIndex,
    selectedRow,
    adjacentEdgeIds,
    activeRowSummary,
    selectionAdapter,
    selectionSnapshotRef,
    handleDeleteSelection,
    handleKeyDown
  } satisfies OutlineSelectionState;
};
