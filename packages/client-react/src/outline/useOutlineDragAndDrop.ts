/**
 * Shared drag-and-drop controller for outline panes. The hook tracks drag intent, computes drop
 * plans, and applies outline mutations while deferring DOM lookups to the consumer via a small
 * adapter surface so different platforms can provide their own pointer plumbing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent
} from "react";

import {
  createMirrorEdge,
  getChildEdgeIds,
  getEdgeSnapshot,
  getParentEdgeId,
  getRootEdgeIds,
  moveEdge,
  withTransaction,
  type EdgeId,
  type NodeId,
  type OutlineDoc,
  type OutlineSnapshot
} from "@thortiq/client-core";
import type { OutlineCursorPlacement } from "@thortiq/editor-prosemirror";

import type { OutlineRow } from "./useOutlineRows";
import type { SelectionRange } from "./useOutlineSelection";

const DRAG_ACTIVATION_THRESHOLD_PX = 4;
const AUTO_SCROLL_ZONE_PX = 64;
const AUTO_SCROLL_MAX_STEP_PX = 24;
const AUTO_SCROLL_MIN_STEP_PX = 6;
const computeAutoScrollStep = (intensity: number): number => {
  const clamped = Math.max(0, Math.min(1, intensity));
  return AUTO_SCROLL_MIN_STEP_PX + clamped * (AUTO_SCROLL_MAX_STEP_PX - AUTO_SCROLL_MIN_STEP_PX);
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const computeInsideEdgeIntensity = (distance: number): number => {
  if (distance < 0 || distance > AUTO_SCROLL_ZONE_PX) {
    return 0;
  }
  return (AUTO_SCROLL_ZONE_PX - distance) / AUTO_SCROLL_ZONE_PX;
};

const computeOutsideEdgeIntensity = (distance: number): number => {
  if (distance <= 0) {
    return 0;
  }
  return clamp01(distance / (distance + AUTO_SCROLL_ZONE_PX));
};

const getAutoScrollIntensities = (
  container: HTMLElement,
  pointerY: number
): { top: number; bottom: number } => {
  const rect = container.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return { top: 0, bottom: 0 };
  }
  const viewportTop = 0;
  const viewportBottom = typeof window !== "undefined" ? window.innerHeight : rect.bottom;
  const visibleTop = Math.max(rect.top, viewportTop);
  const visibleBottom = Math.min(rect.bottom, viewportBottom);
  if (visibleBottom <= visibleTop) {
    return { top: 0, bottom: 0 };
  }

  const distanceToTop = pointerY - visibleTop;
  const distanceToBottom = visibleBottom - pointerY;

  const topIntensity = clamp01(
    Math.max(
      computeInsideEdgeIntensity(distanceToTop),
      computeOutsideEdgeIntensity(visibleTop - pointerY)
    )
  );
  const bottomIntensity = clamp01(
    Math.max(
      computeInsideEdgeIntensity(distanceToBottom),
      computeOutsideEdgeIntensity(pointerY - visibleBottom)
    )
  );

  return { top: topIntensity, bottom: bottomIntensity };
};

const isScrollableElement = (element: HTMLElement): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (!style) {
    return false;
  }
  const overflowY = style.overflowY;
  const overflow = style.overflow;
  const mayScroll =
    overflowY === "auto"
    || overflowY === "scroll"
    || overflow === "auto"
    || overflow === "scroll";
  if (!mayScroll) {
    return false;
  }
  return element.scrollHeight > element.clientHeight;
};

const collectScrollableAncestors = (
  element: HTMLElement | null,
  root: HTMLElement | null
): readonly HTMLElement[] => {
  if (!element || !root || typeof document === "undefined") {
    return root ? [root] : [];
  }
  const ancestors: HTMLElement[] = [];
  let current: HTMLElement | null = element;
  while (current && root.contains(current)) {
    if (isScrollableElement(current)) {
      ancestors.push(current);
    }
    if (current === root) {
      break;
    }
    current = current.parentElement;
  }
  if (ancestors.length === 0 && isScrollableElement(root)) {
    ancestors.push(root);
  }
  if (!ancestors.includes(root) && root.contains(element)) {
    ancestors.push(root);
  }
  return ancestors;
};

type DropIndicatorType = "sibling" | "child";

export interface DragSelectionState {
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
  readonly canonicalDraggedEdgeIds: readonly EdgeId[];
  readonly canonicalDraggedEdgeIdSet: ReadonlySet<EdgeId>;
  readonly draggedNodeIds: readonly NodeId[];
  readonly draggedNodeIdSet: ReadonlySet<NodeId>;
  readonly altKey: boolean;
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

export type OutlinePendingCursor =
  | {
      readonly edgeId: EdgeId;
      readonly placement: "coords";
      readonly clientX: number;
      readonly clientY: number;
    }
  | {
      readonly edgeId: EdgeId;
      readonly placement: "text-end";
    }
  | {
      readonly edgeId: EdgeId;
      readonly placement: "text-start";
    }
  | {
      readonly edgeId: EdgeId;
      readonly placement: "text-offset";
      readonly index: number;
    };

export interface OutlineDragGuidelinePlan {
  readonly toCollapse: readonly EdgeId[];
  readonly toExpand: readonly EdgeId[];
}

export interface OutlineDragDomAdapter {
  readonly elementFromPoint?: (x: number, y: number) => Element | null;
  readonly findRowElement?: (
    parent: HTMLElement | null,
    edgeId: EdgeId
  ) => HTMLElement | null;
}

interface UseOutlineDragAndDropParams {
  readonly outline: OutlineDoc;
  readonly localOrigin: unknown;
  readonly snapshot: OutlineSnapshot;
  readonly rowMap: ReadonlyMap<EdgeId, OutlineRow>;
  readonly edgeIndexMap: ReadonlyMap<EdgeId, number>;
  readonly orderedSelectedEdgeIds: readonly EdgeId[];
  readonly selectedEdgeIds: ReadonlySet<EdgeId>;
  readonly selectionRange: SelectionRange | null;
  readonly setSelectionRange: (range: SelectionRange | null) => void;
  readonly setSelectedEdgeId: (
    edgeId: EdgeId | null,
    options?: { preserveRange?: boolean; cursor?: OutlineCursorPlacement }
  ) => void;
  readonly setPendingCursor: (cursor: OutlinePendingCursor | null) => void;
  readonly setPendingFocusEdgeId: (edgeId: EdgeId | null) => void;
  readonly setCollapsed: (edgeId: EdgeId, collapsed: boolean) => void;
  readonly isEditorEvent: (target: EventTarget | null) => boolean;
  readonly parentRef: MutableRefObject<HTMLDivElement | null>;
  readonly computeGuidelinePlan: (edgeId: EdgeId) => OutlineDragGuidelinePlan | null;
  readonly domAdapter?: OutlineDragDomAdapter;
}

export interface OutlineDragAndDropHandlers {
  readonly activeDrag: ActiveDrag | null;
  readonly hoveredGuidelineEdgeId: EdgeId | null;
  readonly handleGuidelinePointerEnter: (edgeId: EdgeId) => void;
  readonly handleGuidelinePointerLeave: (edgeId: EdgeId) => void;
  readonly handleGuidelineClick: (edgeId: EdgeId) => void;
  readonly handleRowPointerDownCapture: (
    event: ReactPointerEvent<HTMLDivElement>,
    edgeId: EdgeId
  ) => void;
  readonly handleRowMouseDown: (event: ReactMouseEvent<HTMLDivElement>, edgeId: EdgeId) => void;
  readonly handleDragHandlePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, edgeId: EdgeId) => void;
}

export const useOutlineDragAndDrop = ({
  outline,
  localOrigin,
  snapshot,
  rowMap,
  edgeIndexMap,
  orderedSelectedEdgeIds,
  selectedEdgeIds,
  selectionRange,
  setSelectionRange,
  setSelectedEdgeId,
  setPendingCursor,
  setPendingFocusEdgeId,
  setCollapsed,
  isEditorEvent,
  parentRef,
  computeGuidelinePlan,
  domAdapter
}: UseOutlineDragAndDropParams): OutlineDragAndDropHandlers => {
  const dragIntentRef = useRef<DragIntent | null>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const autoScrollPointerRef = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const scrollableAncestorsRef = useRef<readonly HTMLElement[]>([]);
  const [dragSelection, setDragSelection] = useState<DragSelectionState | null>(null);
  const [dragIntent, setDragIntent] = useState<DragIntent | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [hoveredGuidelineEdgeId, setHoveredGuidelineEdgeId] = useState<EdgeId | null>(null);

  const resolveCanonicalEdgeId = useCallback(
    (edgeId: EdgeId): EdgeId => {
      const row = rowMap.get(edgeId);
      return row?.canonicalEdgeId ?? edgeId;
    },
    [rowMap]
  );

  useEffect(() => {
    dragIntentRef.current = dragIntent;
  }, [dragIntent]);

  useEffect(() => {
    activeDragRef.current = activeDrag;
  }, [activeDrag]);

  const stopAutoScroll = useCallback(() => {
    if (typeof window === "undefined") {
      autoScrollFrameRef.current = null;
      return;
    }
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
    }
    autoScrollFrameRef.current = null;
  }, []);

  const findRowElement = useCallback(
    (edgeId: EdgeId): HTMLElement | null => {
      if (domAdapter?.findRowElement) {
        return domAdapter.findRowElement(parentRef.current, edgeId);
      }
      const parent = parentRef.current;
      if (!parent) {
        return null;
      }
      return parent.querySelector<HTMLElement>(
        `[data-outline-row="true"][data-edge-id="${edgeId}"]`
      );
    },
    [domAdapter, parentRef]
  );

  const elementFromPoint = useCallback(
    (x: number, y: number): Element | null => {
      if (domAdapter?.elementFromPoint) {
        return domAdapter.elementFromPoint(x, y);
      }
      if (typeof document === "undefined" || typeof document.elementFromPoint !== "function") {
        return null;
      }
      return document.elementFromPoint(x, y);
    },
    [domAdapter]
  );

  const getProjectedChildEdgeIdsForParent = useCallback(
    (parentEdgeId: EdgeId, parentNodeId: NodeId | null): ReadonlyArray<EdgeId> => {
      const projected = snapshot.childEdgeIdsByParentEdge.get(parentEdgeId);
      if (projected) {
        return projected;
      }
      const canonicalParentEdgeId = snapshot.canonicalEdgeIdsByEdgeId.get(parentEdgeId) ?? parentEdgeId;
      if (canonicalParentEdgeId !== parentEdgeId) {
        const canonicalProjection = snapshot.childEdgeIdsByParentEdge.get(canonicalParentEdgeId);
        if (canonicalProjection) {
          return canonicalProjection;
        }
      }
      if (parentNodeId === null) {
        return snapshot.rootEdgeIds;
      }
      return snapshot.childrenByParent.get(parentNodeId) ?? [];
    },
    [snapshot]
  );

  const handleGuidelinePointerEnter = useCallback((edgeId: EdgeId) => {
    setHoveredGuidelineEdgeId(edgeId);
  }, []);

  const handleGuidelinePointerLeave = useCallback((edgeId: EdgeId) => {
    setHoveredGuidelineEdgeId((current) => (current === edgeId ? null : current));
  }, []);

  const handleGuidelineClick = useCallback(
    (edgeId: EdgeId) => {
      const plan = computeGuidelinePlan(edgeId);
      if (!plan) {
        return;
      }
      plan.toCollapse.forEach((childEdgeId) => setCollapsed(childEdgeId, true));
      plan.toExpand.forEach((childEdgeId) => setCollapsed(childEdgeId, false));
    },
    [computeGuidelinePlan, setCollapsed]
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

      const seenCanonical = new Set<EdgeId>();
      const uniqueRows: OutlineRow[] = [];
      candidateRows.forEach((row) => {
        const canonicalId = row.canonicalEdgeId;
        if (row.edgeId === anchorRow.edgeId) {
          if (!seenCanonical.has(canonicalId)) {
            seenCanonical.add(canonicalId);
          }
          uniqueRows.push(row);
          return;
        }
        if (seenCanonical.has(canonicalId)) {
          return;
        }
        seenCanonical.add(canonicalId);
        uniqueRows.push(row);
      });

      if (!uniqueRows.includes(anchorRow)) {
        uniqueRows.unshift(anchorRow);
      }

      const filteredRows = uniqueRows;

      const parentEdgeId = anchorRow.ancestorEdgeIds[anchorRow.ancestorEdgeIds.length - 1] ?? null;
      const orderedChildren = parentEdgeId === null
        ? snapshot.rootEdgeIds
        : getProjectedChildEdgeIdsForParent(parentEdgeId, anchorRow.parentNodeId);

      const indices = filteredRows.map((row) => orderedChildren.indexOf(row.edgeId));
      if (indices.some((index) => index === -1)) {
        return { edgeIds: [edgeId], nodeIds: [anchorRow.nodeId] };
      }
      const sortedIndices = [...indices].sort((left, right) => left - right);
      for (let index = 1; index < sortedIndices.length; index += 1) {
        if (sortedIndices[index] !== sortedIndices[index - 1]! + 1) {
          return { edgeIds: [edgeId], nodeIds: [anchorRow.nodeId] };
        }
      }

      const orderedRows = [...filteredRows].sort((left, right) => {
        const leftIndex = orderedChildren.indexOf(left.edgeId);
        const rightIndex = orderedChildren.indexOf(right.edgeId);
        return leftIndex - rightIndex;
      });

      return {
        edgeIds: orderedRows.map((row) => row.edgeId),
        nodeIds: orderedRows.map((row) => row.nodeId)
      };
    },
    [getProjectedChildEdgeIdsForParent, orderedSelectedEdgeIds, rowMap, selectedEdgeIds, snapshot]
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
      const container = parentRef.current;
      if (!container) {
        return null;
      }
      const element = elementFromPoint(clientX, clientY);
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

      const findRowElementById = (edgeId: EdgeId): HTMLElement | null => findRowElement(edgeId);

      const createSiblingPlan = (
        targetEdgeId: EdgeId,
        parentEdgeId: EdgeId | null,
        zoneLeft: number
      ): DropPlan | null => {
        const canonicalTargetEdgeId = resolveCanonicalEdgeId(targetEdgeId);
        if (
          drag.draggedEdgeIdSet.has(targetEdgeId)
          || drag.canonicalDraggedEdgeIdSet.has(canonicalTargetEdgeId)
        ) {
          return null;
        }
        let targetRowElement = findRowElementById(targetEdgeId);
        if (!targetRowElement) {
          targetRowElement = rowElement;
        }
        const targetRowRect = targetRowElement.getBoundingClientRect();
        const targetBulletElement = targetRowElement.querySelector<HTMLElement>('[data-outline-bullet]');
        const targetBulletRect = targetBulletElement?.getBoundingClientRect() ?? null;
        const indicatorLeftPx = targetBulletRect?.left ?? zoneLeft;
        const indicatorRightPx = Math.max(containerRight, indicatorLeftPx + 1);

        let targetSnapshot: ReturnType<typeof getEdgeSnapshot>;
        try {
          targetSnapshot = getEdgeSnapshot(outline, canonicalTargetEdgeId);
        } catch {
          return null;
        }
        const targetParentNodeId = targetSnapshot.parentNodeId;
        if (willIntroduceCycle(targetParentNodeId, drag.draggedNodeIdSet)) {
          return null;
        }

        const canonicalSiblings = targetParentNodeId === null
          ? getRootEdgeIds(outline)
          : getChildEdgeIds(outline, targetParentNodeId);
        const referenceIndex = canonicalSiblings.indexOf(canonicalTargetEdgeId);
        if (referenceIndex === -1) {
          return null;
        }

        let insertIndex = referenceIndex + 1;
        const processedCanonical = new Set<EdgeId>();
        drag.canonicalDraggedEdgeIds.forEach((draggedCanonicalEdgeId) => {
          if (processedCanonical.has(draggedCanonicalEdgeId)) {
            return;
          }
          processedCanonical.add(draggedCanonicalEdgeId);
          let draggedSnapshot: ReturnType<typeof getEdgeSnapshot>;
          try {
            draggedSnapshot = getEdgeSnapshot(outline, draggedCanonicalEdgeId);
          } catch {
            return;
          }
          if (draggedSnapshot.parentNodeId === targetParentNodeId) {
            const draggedIndex = canonicalSiblings.indexOf(draggedCanonicalEdgeId);
            if (draggedIndex !== -1 && draggedIndex <= referenceIndex) {
              insertIndex -= 1;
            }
          }
        });
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
        const canonicalTargetEdgeId = resolveCanonicalEdgeId(targetEdgeId);
        if (
          drag.draggedEdgeIdSet.has(targetEdgeId)
          || drag.canonicalDraggedEdgeIdSet.has(canonicalTargetEdgeId)
        ) {
          return null;
        }
        let targetSnapshot: ReturnType<typeof getEdgeSnapshot>;
        try {
          targetSnapshot = getEdgeSnapshot(outline, canonicalTargetEdgeId);
        } catch {
          return null;
        }
        const targetParentNodeId = targetSnapshot.childNodeId;
        if (willIntroduceCycle(targetParentNodeId, drag.draggedNodeIdSet)) {
          return null;
        }

        const targetRowElement = findRowElementById(targetEdgeId) ?? baseRowElement;
        const targetRowRect = targetRowElement.getBoundingClientRect();
        const indicatorLeftPx = textBounds.left;
        const indicatorRightPx = Math.max(containerRight, indicatorLeftPx + 1);
        const indicatorWidth = indicatorRightPx - indicatorLeftPx;
        if (indicatorWidth <= 0) {
          return null;
        }

        const indicator: DropIndicatorDescriptor = {
          edgeId: targetEdgeId,
          left: indicatorLeftPx - targetRowRect.left,
          width: indicatorWidth,
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

      if (textRect && pointerX >= textRect.left) {
        return createChildPlan(hoveredEdgeId, rowElement, textRect);
      }

      const hoveredParentEdgeId = hoveredRow.ancestorEdgeIds[hoveredRow.ancestorEdgeIds.length - 1] ?? null;

      if (pointerX >= bulletLeft) {
        return createSiblingPlan(hoveredEdgeId, hoveredParentEdgeId, bulletLeft);
      }

      if (hoveredRow.ancestorEdgeIds.length === 0) {
        return createSiblingPlan(hoveredEdgeId, null, bulletLeft);
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
      const parentEdgeIdForTarget = ancestorIndex === 0
        ? null
        : hoveredRow.ancestorEdgeIds[ancestorIndex - 1] ?? null;
      return createSiblingPlan(targetEdgeId, parentEdgeIdForTarget, zoneLeft);
    },
    [
      elementFromPoint,
      findRowElement,
      outline,
      parentRef,
      resolveCanonicalEdgeId,
      rowMap,
      willIntroduceCycle
    ]
  );

  const executeDropPlan = useCallback(
    (drag: DragIntent, plan: DropPlan) => {
      let insertionIndex = plan.insertIndex;
      const processed = new Set<EdgeId>();
      drag.canonicalDraggedEdgeIds.forEach((canonicalEdgeId) => {
        if (processed.has(canonicalEdgeId)) {
          return;
        }
        processed.add(canonicalEdgeId);
        moveEdge(outline, canonicalEdgeId, plan.targetParentNodeId, insertionIndex, localOrigin);
        insertionIndex += 1;
      });
    },
    [localOrigin, outline]
  );

  const executeMirrorPlan = useCallback(
    (drag: DragIntent, plan: DropPlan) => {
      const parentNodeId = plan.targetParentNodeId ?? null;
      const baseIndex = plan.insertIndex;
      withTransaction(
        outline,
        () => {
          let offset = 0;
          const processed = new Set<EdgeId>();
          drag.canonicalDraggedEdgeIds.forEach((canonicalEdgeId) => {
            if (processed.has(canonicalEdgeId)) {
              return;
            }
            processed.add(canonicalEdgeId);
            let snapshot: ReturnType<typeof getEdgeSnapshot>;
            try {
              snapshot = getEdgeSnapshot(outline, canonicalEdgeId);
            } catch {
              return;
            }
            const result = createMirrorEdge({
              outline,
              mirrorNodeId: snapshot.childNodeId,
              insertParentNodeId: parentNodeId,
              insertIndex: baseIndex + offset,
              origin: localOrigin
            });
            if (result) {
              offset += 1;
            }
          });
        },
        localOrigin
      );
    },
    [localOrigin, outline]
  );

  // Auto-scroll scrollable ancestors within the current pane while dragging near the edges so off-screen targets become reachable.
  const scheduleAutoScroll = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (autoScrollFrameRef.current !== null) {
      return;
    }

    const step = () => {
      const pointer = autoScrollPointerRef.current;
      const active = activeDragRef.current;
      const ancestors = scrollableAncestorsRef.current;
      if (!pointer || !active || ancestors.length === 0) {
        autoScrollFrameRef.current = null;
        return;
      }

      let didScroll = false;
      for (const container of ancestors) {
        if (!(container instanceof HTMLElement)) {
          continue;
        }
        if (!container.isConnected) {
          continue;
        }
        const { top: topIntensity, bottom: bottomIntensity } = getAutoScrollIntensities(
          container,
          pointer.y
        );
        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        const canScrollUp = topIntensity > 0 && container.scrollTop > 0;
        const canScrollDown = bottomIntensity > 0 && container.scrollTop < maxScrollTop;
        if (!canScrollUp && !canScrollDown) {
          continue;
        }

        let delta = 0;
        if (canScrollDown && (!canScrollUp || bottomIntensity >= topIntensity)) {
          delta = computeAutoScrollStep(bottomIntensity);
        } else if (canScrollUp) {
          delta = -computeAutoScrollStep(topIntensity);
        }

        if (delta === 0 || !Number.isFinite(delta)) {
          continue;
        }

        if (typeof container.scrollBy === "function") {
          container.scrollBy(0, delta);
        } else {
          const nextScrollTop = Math.max(0, Math.min(container.scrollTop + delta, maxScrollTop));
          container.scrollTop = nextScrollTop;
        }

        const plan = resolveDropPlan(pointer.x, pointer.y, active);
        setActiveDrag((previous) => {
          if (!previous || previous.pointerId !== active.pointerId) {
            return previous;
          }
          return {
            ...previous,
            pointerX: pointer.x,
            pointerY: pointer.y,
            plan
          } satisfies ActiveDrag;
        });
        didScroll = true;
        break;
      }

      if (!didScroll) {
        autoScrollFrameRef.current = null;
        return;
      }

      autoScrollFrameRef.current = window.requestAnimationFrame(step);
    };

    autoScrollFrameRef.current = window.requestAnimationFrame(step);
  }, [resolveDropPlan, setActiveDrag]);

  const updateAutoScrollPointer = useCallback(
    (clientX: number, clientY: number) => {
      autoScrollPointerRef.current = { x: clientX, y: clientY };
      if (typeof window === "undefined") {
        return;
      }
      const ensureAncestors = (): readonly HTMLElement[] => {
        if (scrollableAncestorsRef.current.length > 0) {
          return scrollableAncestorsRef.current;
        }
        const root = parentRef.current;
        if (!root) {
          return [];
        }
        const anchorEdgeId = activeDragRef.current?.anchorEdgeId ?? dragIntentRef.current?.anchorEdgeId ?? null;
        const anchorRowElement = anchorEdgeId ? findRowElement(anchorEdgeId) : null;
        const ancestors = collectScrollableAncestors(anchorRowElement ?? root, root);
        scrollableAncestorsRef.current = ancestors;
        return ancestors;
      };
      const ancestors = ensureAncestors();
      if (ancestors.length === 0) {
        stopAutoScroll();
        return;
      }
      const canScrollAny = ancestors.some((container) => {
        if (!(container instanceof HTMLElement)) {
          return false;
        }
        const { top: topIntensity, bottom: bottomIntensity } = getAutoScrollIntensities(container, clientY);
        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        const canScrollUp = topIntensity > 0 && container.scrollTop > 0;
        const canScrollDown = bottomIntensity > 0 && container.scrollTop < maxScrollTop;
        return canScrollUp || canScrollDown;
      });
      if (!canScrollAny) {
        stopAutoScroll();
        return;
      }
      scheduleAutoScroll();
    },
    [findRowElement, parentRef, scheduleAutoScroll, stopAutoScroll]
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
      const rowElement = elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(
        '[data-outline-row="true"]'
      );
      const edgeId = rowElement?.getAttribute("data-edge-id") as EdgeId | null;
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
  }, [dragSelection, edgeIndexMap, elementFromPoint, selectionRange, setSelectionRange, setSelectedEdgeId]);

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
      const canonicalEdgeIds = edgeIds.map(resolveCanonicalEdgeId);
      const rowElement = findRowElement(edgeId);
      const ancestors = collectScrollableAncestors(
        rowElement ?? parentRef.current,
        parentRef.current
      );
      scrollableAncestorsRef.current = ancestors;
      setActiveDrag(null);
      setDragIntent({
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        anchorEdgeId: edgeId,
        draggedEdgeIds: edgeIds,
        draggedEdgeIdSet: new Set(edgeIds),
        canonicalDraggedEdgeIds: canonicalEdgeIds,
        canonicalDraggedEdgeIdSet: new Set(canonicalEdgeIds),
        draggedNodeIds: nodeIds,
        draggedNodeIdSet: new Set(nodeIds),
        altKey: Boolean(event.altKey)
      });
    },
    [computeDragBundle, findRowElement, parentRef, resolveCanonicalEdgeId, rowMap]
  );

  useEffect(() => {
    if (!dragIntent && !activeDrag) {
      stopAutoScroll();
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const currentActive = activeDragRef.current;
      if (currentActive && event.pointerId === currentActive.pointerId) {
        updateAutoScrollPointer(event.clientX, event.clientY);
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
            plan,
            altKey: Boolean(event.altKey)
          } satisfies ActiveDrag;
        });
        return;
      }

      const currentIntent = dragIntentRef.current;
      if (!currentIntent || event.pointerId !== currentIntent.pointerId) {
        return;
      }
      updateAutoScrollPointer(event.clientX, event.clientY);
      const deltaX = Math.abs(event.clientX - currentIntent.startX);
      const deltaY = Math.abs(event.clientY - currentIntent.startY);
      if (Math.max(deltaX, deltaY) < DRAG_ACTIVATION_THRESHOLD_PX) {
        setDragIntent((intent) => {
          if (!intent || intent.pointerId !== event.pointerId) {
            return intent;
          }
          return {
            ...intent,
            altKey: Boolean(event.altKey)
          };
        });
        return;
      }
      event.preventDefault();
      const plan = resolveDropPlan(event.clientX, event.clientY, currentIntent);
      if (scrollableAncestorsRef.current.length === 0) {
        const anchorRowElement = findRowElement(currentIntent.anchorEdgeId);
        scrollableAncestorsRef.current = collectScrollableAncestors(
          anchorRowElement ?? parentRef.current,
          parentRef.current
        );
      }
      setDragIntent(null);
      setActiveDrag({
        ...currentIntent,
        altKey: Boolean(event.altKey),
        pointerX: event.clientX,
        pointerY: event.clientY,
        plan
      });
    };

    const finalizeDrag = (pointerId: number, applyPlan: boolean, altMirror: boolean) => {
      stopAutoScroll();
      scrollableAncestorsRef.current = [];
      setDragIntent((current) => (current?.pointerId === pointerId ? null : current));
      setActiveDrag((current) => {
        if (!current || current.pointerId !== pointerId) {
          return current;
        }
        if (applyPlan && current.plan) {
          const shouldMirror = altMirror || current.altKey;
          if (shouldMirror) {
            executeMirrorPlan(current, current.plan);
          } else {
            executeDropPlan(current, current.plan);
          }
        }
        return null;
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      finalizeDrag(event.pointerId, true, Boolean(event.altKey));
    };

    const handlePointerCancel = (event: PointerEvent) => {
      finalizeDrag(event.pointerId, false, false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [
    activeDrag,
    dragIntent,
    executeDropPlan,
    executeMirrorPlan,
    findRowElement,
    parentRef,
    resolveDropPlan,
    stopAutoScroll,
    updateAutoScrollPointer
  ]);

  useEffect(() => () => stopAutoScroll(), [stopAutoScroll]);

  const handleRowMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, edgeId: EdgeId) => {
      const button = event.button ?? 0;
      if (button !== 0) {
        if (button === 2 && !selectedEdgeIds.has(edgeId)) {
          setSelectedEdgeId(edgeId);
          setPendingFocusEdgeId(edgeId);
        }
        return;
      }
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
      let pendingCursor: OutlinePendingCursor | null = null;
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
    [isEditorEvent, selectedEdgeIds, setPendingCursor, setPendingFocusEdgeId, setSelectedEdgeId]
  );

  return {
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
