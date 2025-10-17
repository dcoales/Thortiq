import { useCallback, useEffect, useState } from "react";
import type { EdgeId } from "@thortiq/client-core";

export interface UseRowDragSelectionParams {
  readonly elementFromPoint: (x: number, y: number) => Element | null;
  readonly edgeIndexMap: ReadonlyMap<EdgeId, number>;
  readonly isSelectable: (edgeId: EdgeId) => boolean;
  readonly setSelectionRange: (range: { anchorEdgeId: EdgeId; focusEdgeId: EdgeId } | null) => void;
  readonly setSelectedEdgeId: (edgeId: EdgeId, options?: { preserveRange?: boolean }) => void;
}

export interface UseRowDragSelectionHandle {
  readonly onRowPointerDownCapture: (event: React.PointerEvent<HTMLDivElement>, edgeId: EdgeId) => void;
}

export const useRowDragSelection = ({
  elementFromPoint,
  edgeIndexMap,
  isSelectable,
  setSelectionRange,
  setSelectedEdgeId
}: UseRowDragSelectionParams): UseRowDragSelectionHandle => {
  const [drag, setDrag] = useState<{ pointerId: number; anchorEdgeId: EdgeId } | null>(null);

  useEffect(() => {
    if (!drag) {
      return;
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) {
        return;
      }
      const rowElement = elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(
        '[data-outline-row="true"]'
      );
      const edgeId = (rowElement?.getAttribute("data-edge-id") ?? null) as EdgeId | null;
      if (!edgeId || !edgeIndexMap.has(edgeId) || !isSelectable(edgeId)) {
        return;
      }
      if (edgeId === drag.anchorEdgeId) {
        setSelectionRange(null);
        setSelectedEdgeId(drag.anchorEdgeId);
        return;
      }
      setSelectionRange({ anchorEdgeId: drag.anchorEdgeId, focusEdgeId: edgeId });
      setSelectedEdgeId(edgeId, { preserveRange: true });
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) {
        return;
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [drag, edgeIndexMap, elementFromPoint, isSelectable, setSelectionRange, setSelectedEdgeId]);

  const onRowPointerDownCapture = useCallback<UseRowDragSelectionHandle["onRowPointerDownCapture"]>((event, edgeId) => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }
    setSelectionRange(null);
    setSelectedEdgeId(edgeId);
    setDrag({ pointerId: event.pointerId, anchorEdgeId: edgeId });
  }, [setSelectionRange, setSelectedEdgeId]);

  return { onRowPointerDownCapture };
};


