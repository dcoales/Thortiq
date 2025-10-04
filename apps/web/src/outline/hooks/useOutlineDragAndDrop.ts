import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent
} from "react";

import {
  getChildEdgeIds,
  getEdgeSnapshot,
  getParentEdgeId,
  getRootEdgeIds,
  moveEdge,
  type EdgeId,
  type NodeId,
  type OutlineDoc,
  type OutlineSnapshot
} from "@thortiq/client-core";
import type { SessionPaneState } from "@thortiq/sync-core";

import { planGuidelineCollapse } from "../utils/guidelineCollapse";
import type { OutlineRow, PendingCursor, SelectionRange } from "../types";

const DRAG_ACTIVATION_THRESHOLD_PX = 4;

type DropIndicatorType = "sibling" | "child";

interface DragSelectionState {
  readonly pointerId: number;
  readonly anchorEdgeId: EdgeId;
}

export interface DragIntent {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly anchorEdgeId: EdgeId;
  readonly draggedEdgeIds: readonly EdgeId[];
  readonly draggedEdgeIdSet: ReadonlySet<EdgeId>;
  readonly draggedNodeIds: readonly NodeId[];
  readonly draggedNodeIdSet: ReadonlySet<NodeId>;
}

export interface DropIndicatorDescriptor {
  readonly edgeId: EdgeId;
  readonly left: number;
  readonly width: number;
  readonly type: DropIndicatorType;
}

export interface DropPlan {
  readonly type: DropIndicatorType;
  readonly targetEdgeId: EdgeId;
  readonly targetParentNodeId: NodeId | null;
  readonly insertIndex: number;
  readonly indicator: DropIndicatorDescriptor;
}

export interface ActiveDrag extends DragIntent {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly plan: DropPlan | null;
}

interface UseOutlineDragAndDropParams {
  readonly outline: OutlineDoc;
  readonly localOrigin: unknown;
  readonly snapshot: OutlineSnapshot;
  readonly pane: SessionPaneState;
  readonly rows: OutlineRow[];
  readonly rowMap: ReadonlyMap<EdgeId, OutlineRow>;
  readonly edgeIndexMap: ReadonlyMap<EdgeId, number>;
  readonly orderedSelectedEdgeIds: readonly EdgeId[];
  readonly selectedEdgeIds: ReadonlySet<EdgeId>;
  readonly selectedEdgeId: EdgeId | null;
  readonly selectionRange: SelectionRange | null;
  readonly setSelectionRange: (range: SelectionRange | null) => void;
  readonly setSelectedEdgeId: (edgeId: EdgeId | null, options?: { preserveRange?: boolean; cursor?: unknown }) => void;
  readonly setPendingCursor: (cursor: PendingCursor | null) => void;
  readonly setPendingFocusEdgeId: (edgeId: EdgeId | null) => void;
  readonly setCollapsed: (edgeId: EdgeId, collapsed: boolean) => void;
  readonly isEditorEvent: (target: EventTarget | null) => boolean;
}

export interface OutlineDragAndDropHandlers {
  readonly parentRef: MutableRefObject<HTMLDivElement | null>;
  readonly activeDrag: ActiveDrag | null;
  readonly hoveredGuidelineEdgeId: EdgeId | null;
  readonly handleGuidelinePointerEnter: (edgeId: EdgeId) => void;
  readonly handleGuidelinePointerLeave: (edgeId: EdgeId) => void;
  readonly handleGuidelineClick: (edgeId: EdgeId) => void;
  readonly handleRowPointerDownCapture: (event: ReactPointerEvent<HTMLDivElement>, edgeId: EdgeId) => void;
  readonly handleRowMouseDown: (event: ReactMouseEvent<HTMLDivElement>, edgeId: EdgeId) => void;
  readonly handleDragHandlePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, edgeId: EdgeId) => void;
}

export const useOutlineDragAndDrop = ({
  outline,
  localOrigin,
  snapshot,
  pane,
  rows,
  rowMap,
  edgeIndexMap,
  orderedSelectedEdgeIds,
  selectedEdgeIds,
  selectedEdgeId,
  selectionRange,
  setSelectionRange,
  setSelectedEdgeId,
  setPendingCursor,
  setPendingFocusEdgeId,
  setCollapsed,
  isEditorEvent
}: UseOutlineDragAndDropParams): OutlineDragAndDropHandlers => {
  // Preserve signature slots for upcoming drag heuristics that rely on rows and the primary selection.
  void rows;
  void selectedEdgeId;
  const parentRef = useRef<HTMLDivElement | null>(null);
  const dragIntentRef = useRef<DragIntent | null>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const [dragSelection, setDragSelection] = useState<DragSelectionState | null>(null);
  const [dragIntent, setDragIntent] = useState<DragIntent | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [hoveredGuidelineEdgeId, setHoveredGuidelineEdgeId] = useState<EdgeId | null>(null);

  useEffect(() => {
    dragIntentRef.current = dragIntent;
  }, [dragIntent]);

  useEffect(() => {
    activeDragRef.current = activeDrag;
  }, [activeDrag]);

  const handleGuidelinePointerEnter = useCallback((edgeId: EdgeId) => {
    setHoveredGuidelineEdgeId(edgeId);
  }, []);

  const handleGuidelinePointerLeave = useCallback((edgeId: EdgeId) => {
    setHoveredGuidelineEdgeId((current) => (current === edgeId ? null : current));
  }, []);

  const handleGuidelineClick = useCallback(
    (edgeId: EdgeId) => {
      const plan = planGuidelineCollapse({
        edgeId,
        snapshot,
        rowMap,
        collapsedEdgeIds: pane.collapsedEdgeIds
      });
      if (!plan) {
        return;
      }
      plan.toCollapse.forEach((childEdgeId) => setCollapsed(childEdgeId, true));
      plan.toExpand.forEach((childEdgeId) => setCollapsed(childEdgeId, false));
    },
    [pane.collapsedEdgeIds, rowMap, setCollapsed, snapshot]
  );

  const computeDragBundle = useCallback(
    (edgeId: EdgeId): { edgeIds: readonly EdgeId[]; nodeIds: readonly NodeId[] } => {
      const anchorRow = rowMap.get(edgeId);
      if (!anchorRow) {
        return { edgeIds: [edgeId], nodeIds: [] };
      }

      if (!selectedEdgeIds.has(edgeId) || orderedSelectedEdgeIds.length === 0) {
        return { edgeIds: [edgeId], nodeIds: [anchorRow.nodeId] };
      }

      const candidateRows = orderedSelectedEdgeIds
        .map((candidateEdgeId) => rowMap.get(candidateEdgeId))
        .filter((row): row is OutlineRow => Boolean(row))
        .filter((row) => row.parentNodeId === anchorRow.parentNodeId && row.treeDepth === anchorRow.treeDepth);

      if (candidateRows.length <= 1) {
        return { edgeIds: [edgeId], nodeIds: [anchorRow.nodeId] };
      }

      const parentNodeId = anchorRow.parentNodeId;
      const orderedChildren = parentNodeId === null
        ? snapshot.rootEdgeIds
        : snapshot.childrenByParent.get(parentNodeId) ?? [];

      const indices = candidateRows.map((row) => orderedChildren.indexOf(row.edgeId));
      if (indices.some((index) => index === -1)) {
        return { edgeIds: [edgeId], nodeIds: [anchorRow.nodeId] };
      }
      const sortedIndices = [...indices].sort((left, right) => left - right);
      for (let index = 1; index < sortedIndices.length; index += 1) {
        if (sortedIndices[index] !== sortedIndices[index - 1]! + 1) {
          return { edgeIds: [edgeId], nodeIds: [anchorRow.nodeId] };
        }
      }

      const orderedRows = [...candidateRows].sort((left, right) => {
        const leftIndex = orderedChildren.indexOf(left.edgeId);
        const rightIndex = orderedChildren.indexOf(right.edgeId);
        return leftIndex - rightIndex;
      });

      return {
        edgeIds: orderedRows.map((row) => row.edgeId),
        nodeIds: orderedRows.map((row) => row.nodeId)
      };
    },
    [orderedSelectedEdgeIds, rowMap, selectedEdgeIds, snapshot]
  );

  const willIntroduceCycle = useCallback(
    (targetParentNodeId: NodeId | null, draggedNodeIdSet: ReadonlySet<NodeId>): boolean => {
      if (!targetParentNodeId) {
        return false;
      }
      let current: NodeId | null = targetParentNodeId;
      const visited = new Set<NodeId>();
      while (current) {
        if (draggedNodeIdSet.has(current)) {
          return true;
        }
        if (visited.has(current)) {
          break;
        }
        visited.add(current);
        const parentEdgeId = getParentEdgeId(outline, current);
        if (!parentEdgeId) {
          break;
        }
        try {
          const parentSnapshot = getEdgeSnapshot(outline, parentEdgeId);
          current = parentSnapshot.parentNodeId;
        } catch {
          break;
        }
      }
      return false;
    },
    [outline]
  );

  const resolveDropPlan = useCallback(
    (clientX: number, clientY: number, drag: DragIntent): DropPlan | null => {
      if (typeof document === "undefined") {
        return null;
      }
      const container = parentRef.current;
      if (!container) {
        return null;
      }
      const element = document.elementFromPoint(clientX, clientY);
      if (!element) {
        return null;
      }
      const rowElement = element.closest<HTMLElement>('[data-outline-row="true"]');
      if (!rowElement) {
        return null;
      }
      const edgeAttr = rowElement.getAttribute("data-edge-id");
      if (!edgeAttr) {
        return null;
      }
      const hoveredEdgeId = edgeAttr as EdgeId;
      const hoveredRow = rowMap.get(hoveredEdgeId);
      if (!hoveredRow) {
        return null;
      }

      const paneRect = container.getBoundingClientRect();
      const rowRect = rowElement.getBoundingClientRect();
      const textCellElement = rowElement.querySelector<HTMLElement>('[data-outline-text-cell="true"]');
      const textRect = textCellElement?.getBoundingClientRect() ?? null;
      const bulletElement = rowElement.querySelector<HTMLElement>('[data-outline-bullet]');
      const bulletRect = bulletElement?.getBoundingClientRect() ?? null;
      const pointerX = clientX;
      const bulletLeft = bulletRect?.left ?? (textRect?.left ?? rowRect.left);
      const containerRight = paneRect.right;

      const findRowElement = (edgeId: EdgeId): HTMLElement | null => {
        return container.querySelector<HTMLElement>(
          `[data-outline-row="true"][data-edge-id="${edgeId}"]`
        );
      };

      const createSiblingPlan = (targetEdgeId: EdgeId, zoneLeft: number): DropPlan | null => {
        if (drag.draggedEdgeIdSet.has(targetEdgeId)) {
          return null;
        }
        let targetRowElement = findRowElement(targetEdgeId);
        if (!targetRowElement) {
          targetRowElement = rowElement;
        }
        const targetRowRect = targetRowElement.getBoundingClientRect();
        const targetBulletElement = targetRowElement.querySelector<HTMLElement>('[data-outline-bullet]');
        const targetBulletRect = targetBulletElement?.getBoundingClientRect() ?? null;
        const indicatorLeftPx = targetBulletRect?.left ?? zoneLeft;
        const indicatorRightPx = Math.max(containerRight, indicatorLeftPx + 1);

        let targetSnapshot;
        try {
          targetSnapshot = getEdgeSnapshot(outline, targetEdgeId);
        } catch {
          return null;
        }
        const targetParentNodeId = targetSnapshot.parentNodeId;
        if (willIntroduceCycle(targetParentNodeId, drag.draggedNodeIdSet)) {
          return null;
        }

        const siblings = targetParentNodeId === null
          ? getRootEdgeIds(outline)
          : getChildEdgeIds(outline, targetParentNodeId);
        const referenceIndex = siblings.indexOf(targetEdgeId);
        if (referenceIndex === -1) {
          return null;
        }

        let insertIndex = referenceIndex + 1;
        for (const draggedEdgeId of drag.draggedEdgeIds) {
          if (draggedEdgeId === targetEdgeId) {
            continue;
          }
          let draggedSnapshot;
          try {
            draggedSnapshot = getEdgeSnapshot(outline, draggedEdgeId);
          } catch {
            continue;
          }
          if (draggedSnapshot.parentNodeId === targetParentNodeId) {
            const draggedIndex = siblings.indexOf(draggedEdgeId);
            if (draggedIndex !== -1 && draggedIndex <= referenceIndex) {
              insertIndex -= 1;
            }
          }
        }
        if (insertIndex < 0) {
          insertIndex = 0;
        }

        const indicatorWidth = indicatorRightPx - indicatorLeftPx;
        if (indicatorWidth <= 0) {
          return null;
        }

        const indicator: DropIndicatorDescriptor = {
          edgeId: targetEdgeId,
          left: indicatorLeftPx - targetRowRect.left,
          width: indicatorWidth,
          type: "sibling"
        };

        return {
          type: "sibling",
          targetEdgeId,
          targetParentNodeId,
          insertIndex,
          indicator
        } satisfies DropPlan;
      };

      const createChildPlan = (
        targetEdgeId: EdgeId,
        baseRowElement: HTMLElement,
        textBounds: DOMRect
      ): DropPlan | null => {
        if (drag.draggedEdgeIdSet.has(targetEdgeId)) {
          return null;
        }
        let targetSnapshot;
        try {
          targetSnapshot = getEdgeSnapshot(outline, targetEdgeId);
        } catch {
          return null;
        }
        const targetParentNodeId = targetSnapshot.childNodeId;
        if (willIntroduceCycle(targetParentNodeId, drag.draggedNodeIdSet)) {
          return null;
        }

        const targetRowElement = findRowElement(targetEdgeId) ?? baseRowElement;
        const targetRowRect = targetRowElement.getBoundingClientRect();
        const indicatorLeftPx = textBounds.left;
        const indicatorRightPx = Math.max(containerRight, indicatorLeftPx + textBounds.width);

        const indicator: DropIndicatorDescriptor = {
          edgeId: targetEdgeId,
          left: indicatorLeftPx - targetRowRect.left,
          width: Math.max(1, indicatorRightPx - indicatorLeftPx),
          type: "child"
        };

        return {
          type: "child",
          targetEdgeId,
          targetParentNodeId,
          insertIndex: 0,
          indicator
        } satisfies DropPlan;
      };

      if (textRect) {
        const midpoint = textRect.left + textRect.width / 2;
        if (pointerX >= midpoint) {
          const plan = createSiblingPlan(hoveredEdgeId, textRect.left);
          if (plan) {
            return plan;
          }
        }
        return createChildPlan(hoveredEdgeId, rowElement, textRect);
      }

      const ancestorAreaLeft = rowRect.left;
      const ancestorAreaRight = bulletLeft;
      const areaWidth = Math.max(ancestorAreaRight - ancestorAreaLeft, 1);
      const zoneWidth = areaWidth / hoveredRow.ancestorEdgeIds.length;
      const relative = Math.max(0, Math.min(areaWidth, pointerX - ancestorAreaLeft));
      const ancestorIndex = Math.min(
        hoveredRow.ancestorEdgeIds.length - 1,
        Math.floor(relative / Math.max(zoneWidth, 1))
      );
      const targetEdgeId = hoveredRow.ancestorEdgeIds[ancestorIndex] ?? hoveredEdgeId;
      const zoneLeft = ancestorAreaLeft + zoneWidth * ancestorIndex;
      return createSiblingPlan(targetEdgeId, zoneLeft);
    },
    [outline, parentRef, rowMap, willIntroduceCycle]
  );

  const executeDropPlan = useCallback(
    (drag: DragIntent, plan: DropPlan) => {
      let insertionIndex = plan.insertIndex;
      for (const edgeId of drag.draggedEdgeIds) {
        moveEdge(outline, edgeId, plan.targetParentNodeId, insertionIndex, localOrigin);
        insertionIndex += 1;
      }
    },
    [localOrigin, outline]
  );

  const handleRowPointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, edgeId: EdgeId) => {
      if (!event.isPrimary || event.button !== 0) {
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('[data-outline-toggle="true"]')) {
        return;
      }
      if (target?.closest('[data-outline-drag-handle="true"]')) {
        return;
      }
      if (target?.closest('[data-outline-guideline="true"]')) {
        return;
      }
      setSelectionRange(null);
      setSelectedEdgeId(edgeId);
      setDragSelection({ pointerId: event.pointerId, anchorEdgeId: edgeId });
    },
    [setSelectionRange, setSelectedEdgeId]
  );

  const handleDragHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, edgeId: EdgeId) => {
      if (!event.isPrimary || event.button !== 0) {
        return;
      }
      event.stopPropagation();
      const bundle = computeDragBundle(edgeId);
      const edgeIds = bundle.edgeIds.length > 0 ? bundle.edgeIds : [edgeId];
      const fallbackNodeId = rowMap.get(edgeId)?.nodeId;
      const nodeIds = bundle.nodeIds.length > 0
        ? bundle.nodeIds
        : fallbackNodeId
          ? [fallbackNodeId]
          : [];
      setActiveDrag(null);
      setDragIntent({
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        anchorEdgeId: edgeId,
        draggedEdgeIds: edgeIds,
        draggedEdgeIdSet: new Set(edgeIds),
        draggedNodeIds: nodeIds,
        draggedNodeIdSet: new Set(nodeIds)
      });
    },
    [computeDragBundle, rowMap]
  );

  useEffect(() => {
    if (!dragIntent && !activeDrag) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const currentActive = activeDragRef.current;
      if (currentActive && event.pointerId === currentActive.pointerId) {
        event.preventDefault();
        const plan = resolveDropPlan(event.clientX, event.clientY, currentActive);
        setActiveDrag((previous) => {
          if (!previous || previous.pointerId !== event.pointerId) {
            return previous;
          }
          return {
            ...previous,
            pointerX: event.clientX,
            pointerY: event.clientY,
            plan
          } satisfies ActiveDrag;
        });
        return;
      }

      const intent = dragIntentRef.current;
      if (intent && event.pointerId === intent.pointerId) {
        const deltaX = Math.abs(event.clientX - intent.startX);
        const deltaY = Math.abs(event.clientY - intent.startY);
        if (deltaX >= DRAG_ACTIVATION_THRESHOLD_PX || deltaY >= DRAG_ACTIVATION_THRESHOLD_PX) {
          const plan = resolveDropPlan(event.clientX, event.clientY, intent);
          setDragIntent(null);
          setActiveDrag({
            ...intent,
            pointerX: event.clientX,
            pointerY: event.clientY,
            plan
          });
        }
      }
    };

    const finalizeDrag = (pointerId: number, shouldApply: boolean) => {
      const currentActive = activeDragRef.current;
      if (currentActive && pointerId === currentActive.pointerId) {
        if (shouldApply && currentActive.plan) {
          executeDropPlan(currentActive, currentActive.plan);
        }
        setActiveDrag(null);
        setDragIntent(null);
        return;
      }

      const intent = dragIntentRef.current;
      if (intent && pointerId === intent.pointerId) {
        setDragIntent(null);
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      finalizeDrag(event.pointerId, true);
    };

    const handlePointerCancel = (event: PointerEvent) => {
      finalizeDrag(event.pointerId, false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [activeDrag, dragIntent, executeDropPlan, resolveDropPlan]);

  const handleRowMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, edgeId: EdgeId) => {
      if (isEditorEvent(event.target)) {
        return;
      }
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('[data-outline-toggle="true"]')
      ) {
        return;
      }
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('[data-outline-guideline="true"]')
      ) {
        return;
      }
      event.preventDefault();
      const { clientX, clientY } = event;
      let pendingCursor: PendingCursor | null = null;
      const targetElement = event.target instanceof HTMLElement ? event.target : null;
      const textCell = targetElement?.closest('[data-outline-text-cell="true"]') ?? null;
      const textContent = targetElement?.closest('[data-outline-text-content="true"]') ?? null;
      if (textCell && !textContent) {
        const contentElement = textCell.querySelector<HTMLElement>('[data-outline-text-content="true"]');
        if (contentElement) {
          const { right } = contentElement.getBoundingClientRect();
          if (clientX >= right) {
            pendingCursor = { edgeId, placement: "text-end" };
          }
        }
      }
      if (!pendingCursor) {
        pendingCursor = { edgeId, placement: "coords", clientX, clientY };
      }
      setPendingCursor(pendingCursor);
      setPendingFocusEdgeId(pendingCursor.edgeId);
      setSelectedEdgeId(edgeId);
    },
    [isEditorEvent, setPendingCursor, setPendingFocusEdgeId, setSelectedEdgeId]
  );

  const findEdgeIdFromPoint = useCallback((clientX: number, clientY: number): EdgeId | null => {
    if (typeof document === "undefined") {
      return null;
    }
    const element = document.elementFromPoint(clientX, clientY);
    if (!element) {
      return null;
    }
    const rowElement = element.closest<HTMLElement>('[data-outline-row="true"]');
    if (!rowElement) {
      return null;
    }
    const edgeId = rowElement.getAttribute("data-edge-id");
    return edgeId ? (edgeId as EdgeId) : null;
  }, []);

  useEffect(() => {
    if (!dragSelection) {
      return;
    }
    if (typeof window === "undefined") {
      setDragSelection(null);
      return;
    }
    if (!edgeIndexMap.has(dragSelection.anchorEdgeId)) {
      setDragSelection(null);
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragSelection.pointerId) {
        return;
      }
      const edgeId = findEdgeIdFromPoint(event.clientX, event.clientY);
      if (!edgeId || !edgeIndexMap.has(edgeId)) {
        return;
      }
      if (edgeId === dragSelection.anchorEdgeId) {
        if (selectionRange) {
          setSelectionRange(null);
        }
        setSelectedEdgeId(dragSelection.anchorEdgeId);
        return;
      }
      if (
        selectionRange
        && selectionRange.anchorEdgeId === dragSelection.anchorEdgeId
        && selectionRange.focusEdgeId === edgeId
      ) {
        setSelectedEdgeId(edgeId, { preserveRange: true });
        return;
      }
      setSelectionRange({ anchorEdgeId: dragSelection.anchorEdgeId, focusEdgeId: edgeId });
      setSelectedEdgeId(edgeId, { preserveRange: true });
    };

    const endDrag = (event: PointerEvent) => {
      if (event.pointerId !== dragSelection.pointerId) {
        return;
      }
      setDragSelection(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [dragSelection, edgeIndexMap, findEdgeIdFromPoint, selectionRange, setSelectionRange, setSelectedEdgeId]);

  useEffect(() => {
    if (!hoveredGuidelineEdgeId) {
      return;
    }
    if (!rowMap.has(hoveredGuidelineEdgeId)) {
      setHoveredGuidelineEdgeId(null);
    }
  }, [hoveredGuidelineEdgeId, rowMap]);

  return {
    parentRef,
    activeDrag,
    hoveredGuidelineEdgeId,
    handleGuidelinePointerEnter,
    handleGuidelinePointerLeave,
    handleGuidelineClick,
    handleRowPointerDownCapture,
    handleRowMouseDown,
    handleDragHandlePointerDown
  } satisfies OutlineDragAndDropHandlers;
};
