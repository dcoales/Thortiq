/**
 * Shared selection controller hook for outline panes. It centralises range derivation, keyboard
 * command handling, and deletion safeguards so platform adapters reuse the same behaviour without
 * duplicating session mutations.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";

import type {
  OutlineCommandId,
  EdgeId,
  OutlineDoc
} from "@thortiq/client-core";
import {
  indentEdges,
  insertChild,
  insertSiblingBelow,
  outdentEdges,
  createDeleteEdgesPlan,
  deleteEdges,
  toggleTodoDoneCommand
} from "@thortiq/outline-commands";
import type { OutlineSelectionAdapter, OutlineCursorPlacement } from "@thortiq/editor-prosemirror";

import type { OutlineRow } from "./useOutlineRows";

export interface SelectionRange {
  readonly anchorEdgeId: EdgeId;
  readonly focusEdgeId: EdgeId;
}

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
  readonly handleCommand: (commandId: OutlineCommandId) => boolean;
}

interface UseOutlineSelectionParams {
  readonly rows: OutlineRow[];
  readonly edgeIndexMap: ReadonlyMap<EdgeId, number>;
  readonly paneSelectionRange: { anchorEdgeId: EdgeId; headEdgeId: EdgeId } | undefined;
  readonly selectedEdgeId: EdgeId | null;
  readonly outline: OutlineDoc;
  readonly localOrigin: unknown;
  readonly setSelectionRange: (range: SelectionRange | null) => void;
  readonly setSelectedEdgeId: (
    edgeId: EdgeId | null,
    options?: { preserveRange?: boolean; cursor?: OutlineCursorPlacement }
  ) => void;
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
    const mapped = edgeIndexMap.get(selectedEdgeId);
    return mapped ?? -1;
  }, [edgeIndexMap, selectedEdgeId]);

  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] ?? null : null;

  const canonicalEdgeIdMap = useMemo(() => {
    const map = new Map<EdgeId, EdgeId>();
    rows.forEach((row) => {
      map.set(row.edgeId, row.canonicalEdgeId);
      if (!map.has(row.canonicalEdgeId)) {
        map.set(row.canonicalEdgeId, row.canonicalEdgeId);
      }
    });
    return map as ReadonlyMap<EdgeId, EdgeId>;
  }, [rows]);

  const resolveCanonicalEdgeId = useCallback(
    (edgeId: EdgeId | null): EdgeId | null => {
      if (!edgeId) {
        return null;
      }
      return canonicalEdgeIdMap.get(edgeId) ?? edgeId;
    },
    [canonicalEdgeIdMap]
  );

  const resolveCanonicalEdgeIdStrict = useCallback(
    (edgeId: EdgeId): EdgeId => {
      return canonicalEdgeIdMap.get(edgeId) ?? edgeId;
    },
    [canonicalEdgeIdMap]
  );

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
    return selectedRow ? new Set<EdgeId>([selectedRow.edgeId]) : new Set<EdgeId>();
  }, [edgeIndexMap, rows, selectedRow, selectionRange]);

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
    primaryEdgeId: resolveCanonicalEdgeId(selectedEdgeId),
    orderedEdgeIds: orderedSelectedEdgeIds.map(resolveCanonicalEdgeIdStrict)
  });

  useEffect(() => {
    selectionSnapshotRef.current = {
      primaryEdgeId: resolveCanonicalEdgeId(selectedEdgeId),
      orderedEdgeIds: orderedSelectedEdgeIds.map(resolveCanonicalEdgeIdStrict)
    };
  }, [orderedSelectedEdgeIds, resolveCanonicalEdgeId, resolveCanonicalEdgeIdStrict, selectedEdgeId]);

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
      const canonicalEdgeId = resolveCanonicalEdgeId(edgeId ?? null);
      setSelectedEdgeId(canonicalEdgeId, options?.cursor ? { cursor: options.cursor } : undefined);
    },
    clearRange: () => {
      setSelectionRange(null);
    }
  }), [resolveCanonicalEdgeId, setSelectionRange, setSelectedEdgeId]);

  const handleDeleteSelection = useCallback((): boolean => {
    const edgeIds = orderedSelectedEdgeIds;
    if (edgeIds.length === 0) {
      return false;
    }

    const canonicalEdgeIds = edgeIds.map(resolveCanonicalEdgeIdStrict);
    const plan = createDeleteEdgesPlan(outline, canonicalEdgeIds);
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
  }, [localOrigin, orderedSelectedEdgeIds, outline, resolveCanonicalEdgeIdStrict, setSelectedEdgeId]);

  const focusNextRow = useCallback((): boolean => {
    if (!rows.length || selectedIndex === -1 || !selectedEdgeId) {
      return false;
    }
    const nextIndex = Math.min(selectedIndex + 1, rows.length - 1);
    const targetEdgeId = rows[nextIndex]?.edgeId ?? selectedEdgeId;
    if (!targetEdgeId) {
      return false;
    }
    setSelectionRange(null);
    setSelectedEdgeId(targetEdgeId);
    return true;
  }, [rows, selectedEdgeId, selectedIndex, setSelectedEdgeId, setSelectionRange]);

  const focusPreviousRow = useCallback((): boolean => {
    if (!rows.length || selectedIndex === -1 || !selectedEdgeId) {
      return false;
    }
    const previousIndex = Math.max(selectedIndex - 1, 0);
    const targetEdgeId = rows[previousIndex]?.edgeId ?? selectedEdgeId;
    if (!targetEdgeId) {
      return false;
    }
    setSelectionRange(null);
    setSelectedEdgeId(targetEdgeId);
    return true;
  }, [rows, selectedEdgeId, selectedIndex, setSelectedEdgeId, setSelectionRange]);

  const toggleTodo = useCallback((): boolean => {
    const row = selectedRow;
    if (!row) {
      return false;
    }
    const targets = orderedSelectedEdgeIds.length > 0 ? orderedSelectedEdgeIds : [row.edgeId];
    if (targets.length === 0) {
      return false;
    }
    const canonicalTargets = targets.map(resolveCanonicalEdgeIdStrict);
    toggleTodoDoneCommand({ outline, origin: localOrigin }, canonicalTargets);
    return true;
  }, [localOrigin, orderedSelectedEdgeIds, outline, resolveCanonicalEdgeIdStrict, selectedRow]);

  const insertSiblingBelowCommand = useCallback((): boolean => {
    const row = selectedRow ?? rows[0] ?? null;
    if (!row) {
      return false;
    }
    setSelectionRange(null);
    const result = insertSiblingBelow({ outline, origin: localOrigin }, row.canonicalEdgeId);
    setSelectedEdgeId(result.edgeId);
    return true;
  }, [localOrigin, outline, rows, selectedRow, setSelectionRange, setSelectedEdgeId]);

  const insertChildCommand = useCallback((): boolean => {
    const row = selectedRow ?? rows[0] ?? null;
    if (!row) {
      return false;
    }
    setSelectionRange(null);
    const result = insertChild({ outline, origin: localOrigin }, row.canonicalEdgeId);
    setSelectedEdgeId(result.edgeId);
    return true;
  }, [localOrigin, outline, rows, selectedRow, setSelectionRange, setSelectedEdgeId]);

  const indentSelectionCommand = useCallback((): boolean => {
    const row = selectedRow;
    if (!row) {
      return false;
    }
    const edgeIdsToIndent = orderedSelectedEdgeIds.length > 0 ? orderedSelectedEdgeIds : [row.edgeId];
    if (edgeIdsToIndent.length === 0) {
      return false;
    }
    const preserveRange = edgeIdsToIndent.length > 1;
    let anchorEdgeId: EdgeId | null = null;
    let focusEdgeId: EdgeId | null = null;
    if (preserveRange) {
      anchorEdgeId = edgeIdsToIndent[0] ?? null;
      focusEdgeId = edgeIdsToIndent[edgeIdsToIndent.length - 1] ?? null;
    }
    const canonicalEdgeIdsToIndent = edgeIdsToIndent.map(resolveCanonicalEdgeIdStrict);
    const result = indentEdges(
      { outline, origin: localOrigin },
      [...canonicalEdgeIdsToIndent].reverse()
    );
    if (!result) {
      return true;
    }
    if (preserveRange && anchorEdgeId && focusEdgeId) {
      const canonicalAnchor = resolveCanonicalEdgeIdStrict(anchorEdgeId);
      const canonicalFocus = resolveCanonicalEdgeIdStrict(focusEdgeId);
      setSelectionRange({ anchorEdgeId: canonicalAnchor, focusEdgeId: canonicalFocus });
      setSelectedEdgeId(row.canonicalEdgeId, { preserveRange: true });
    } else {
      setSelectionRange(null);
      setSelectedEdgeId(row.canonicalEdgeId);
    }
    return true;
  }, [localOrigin, orderedSelectedEdgeIds, outline, resolveCanonicalEdgeIdStrict, selectedRow, setSelectionRange, setSelectedEdgeId]);

  const outdentSelectionCommand = useCallback((): boolean => {
    const row = selectedRow;
    if (!row) {
      return false;
    }
    const edgeIdsToOutdent = orderedSelectedEdgeIds.length > 0 ? orderedSelectedEdgeIds : [row.edgeId];
    if (edgeIdsToOutdent.length === 0) {
      return false;
    }
    const preserveRange = edgeIdsToOutdent.length > 1;
    let anchorEdgeId: EdgeId | null = null;
    let focusEdgeId: EdgeId | null = null;
    if (preserveRange) {
      anchorEdgeId = edgeIdsToOutdent[0] ?? null;
      focusEdgeId = edgeIdsToOutdent[edgeIdsToOutdent.length - 1] ?? null;
    }
    const canonicalEdgeIdsToOutdent = edgeIdsToOutdent.map(resolveCanonicalEdgeIdStrict);
    const result = outdentEdges({ outline, origin: localOrigin }, canonicalEdgeIdsToOutdent);
    if (!result) {
      return true;
    }
    if (preserveRange && anchorEdgeId && focusEdgeId) {
      const canonicalAnchor = resolveCanonicalEdgeIdStrict(anchorEdgeId);
      const canonicalFocus = resolveCanonicalEdgeIdStrict(focusEdgeId);
      setSelectionRange({ anchorEdgeId: canonicalAnchor, focusEdgeId: canonicalFocus });
      setSelectedEdgeId(row.canonicalEdgeId, { preserveRange: true });
    } else {
      setSelectionRange(null);
      setSelectedEdgeId(row.canonicalEdgeId);
    }
    return true;
  }, [localOrigin, orderedSelectedEdgeIds, outline, resolveCanonicalEdgeIdStrict, selectedRow, setSelectionRange, setSelectedEdgeId]);

  const collapseOrFocusParent = useCallback((): boolean => {
    const row = selectedRow;
    if (!row) {
      return false;
    }
    setSelectionRange(null);
    if (row.hasChildren && !row.collapsed) {
      setCollapsed(row.edgeId, true);
      return true;
    }
    const parentRow = findParentRow(rows, row);
    if (parentRow) {
      setSelectedEdgeId(parentRow.edgeId);
    }
    return true;
  }, [rows, selectedRow, setCollapsed, setSelectedEdgeId, setSelectionRange]);

  const expandOrFocusChild = useCallback((): boolean => {
    const row = selectedRow;
    if (!row) {
      return false;
    }
    setSelectionRange(null);
    if (row.collapsed && row.hasChildren) {
      setCollapsed(row.edgeId, false);
      return true;
    }
    const childRow = findFirstChildRow(rows, row);
    if (childRow) {
      setSelectedEdgeId(childRow.edgeId);
    }
    return true;
  }, [rows, selectedRow, setCollapsed, setSelectedEdgeId, setSelectionRange]);

  const handleCommand = useCallback(
    (commandId: OutlineCommandId): boolean => {
      switch (commandId) {
        case "outline.focusNextRow":
          return focusNextRow();
        case "outline.focusPreviousRow":
          return focusPreviousRow();
        case "outline.toggleTodoDone":
          return toggleTodo();
        case "outline.insertSiblingBelow":
          return insertSiblingBelowCommand();
        case "outline.insertChild":
          return insertChildCommand();
        case "outline.indentSelection":
          return indentSelectionCommand();
        case "outline.outdentSelection":
          return outdentSelectionCommand();
        case "outline.collapseOrFocusParent":
          return collapseOrFocusParent();
        case "outline.expandOrFocusChild":
          return expandOrFocusChild();
        case "outline.deleteSelection":
          return handleDeleteSelection();
        default:
          return false;
      }
    },
    [
      collapseOrFocusParent,
      expandOrFocusChild,
      focusNextRow,
      focusPreviousRow,
      handleDeleteSelection,
      indentSelectionCommand,
      insertChildCommand,
      insertSiblingBelowCommand,
      outdentSelectionCommand,
      toggleTodo
    ]
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
    handleCommand
  } satisfies OutlineSelectionState;
};
