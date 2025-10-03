/**
 * Keeps cursor placement, pane focus history, and pending ProseMirror requests in sync with the
 * collaborative session store. UI components delegate to this hook so they can concentrate on
 * rendering while cursor intent remains testable and platform-agnostic.
 */
import { useCallback } from "react";

import type { EdgeId, OutlineSnapshot } from "@thortiq/client-core";
import type { OutlineCursorPlacement } from "@thortiq/editor-prosemirror";
import {
  clearPaneFocus,
  focusPaneEdge,
  stepPaneFocusHistory,
  type FocusHistoryDirection,
  type FocusPanePayload,
  type SessionStore
} from "@thortiq/sync-core";

import type { PendingCursor } from "../types";
import type { PaneSessionController, SetActiveEdgeOptions } from "./usePaneSessionController";

interface CursorManagerParams {
  readonly paneId: string;
  readonly paneRootEdgeId: EdgeId | null;
  readonly snapshot: OutlineSnapshot;
  readonly sessionStore: SessionStore;
  readonly controller: Pick<
    PaneSessionController,
    "setSelectionRange" | "setActiveEdge" | "setPendingFocusEdgeId"
  >;
  readonly applyPendingCursor: (cursor: PendingCursor | null) => void;
}

interface SetSelectedEdgeOptions extends SetActiveEdgeOptions {
  readonly cursor?: OutlineCursorPlacement;
}

export interface OutlineCursorManager {
  readonly setSelectedEdgeId: (edgeId: EdgeId | null, options?: SetSelectedEdgeOptions) => void;
  readonly handleFocusEdge: (payload: FocusPanePayload) => void;
  readonly handleClearFocus: () => void;
  readonly handleNavigateHistory: (direction: FocusHistoryDirection) => void;
}

export const useOutlineCursorManager = ({
  paneId,
  paneRootEdgeId,
  snapshot,
  sessionStore,
  controller,
  applyPendingCursor
}: CursorManagerParams): OutlineCursorManager => {
  const { setSelectionRange, setActiveEdge, setPendingFocusEdgeId } = controller;

  const setSelectedEdgeId = useCallback(
    (edgeId: EdgeId | null, options: SetSelectedEdgeOptions = {}) => {
      const { preserveRange = false, cursor } = options;
      if (!preserveRange) {
        setSelectionRange(null);
      }
      if (edgeId && cursor) {
        const pendingCursor: PendingCursor =
          cursor === "end"
            ? { edgeId, placement: "text-end" }
            : cursor === "start"
              ? { edgeId, placement: "text-start" }
              : { edgeId, placement: "text-offset", index: cursor.index };
        applyPendingCursor(pendingCursor);
        setPendingFocusEdgeId(edgeId);
      } else if (!edgeId && cursor) {
        applyPendingCursor(null);
        setPendingFocusEdgeId(null);
      }
      setActiveEdge(edgeId, { preserveRange });
    },
    [applyPendingCursor, setActiveEdge, setPendingFocusEdgeId, setSelectionRange]
  );

  const handleFocusEdge = useCallback(
    (payload: FocusPanePayload) => {
      focusPaneEdge(sessionStore, paneId, payload);
      const edgeSnapshot = snapshot.edges.get(payload.edgeId);
      if (!edgeSnapshot) {
        setSelectedEdgeId(null);
        return;
      }
      const childEdgeIds = snapshot.childrenByParent.get(edgeSnapshot.childNodeId) ?? [];
      if (childEdgeIds.length > 0) {
        setSelectedEdgeId(childEdgeIds[0]);
      } else {
        setSelectedEdgeId(null);
      }
    },
    [paneId, sessionStore, setSelectedEdgeId, snapshot]
  );

  const handleClearFocus = useCallback(() => {
    const focusedEdgeId = paneRootEdgeId;
    clearPaneFocus(sessionStore, paneId);
    if (focusedEdgeId) {
      setSelectedEdgeId(focusedEdgeId);
    }
  }, [paneId, paneRootEdgeId, sessionStore, setSelectedEdgeId]);

  const handleNavigateHistory = useCallback(
    (direction: FocusHistoryDirection) => {
      const entry = stepPaneFocusHistory(sessionStore, paneId, direction);
      if (!entry) {
        return;
      }
      if (entry.rootEdgeId === null) {
        setSelectedEdgeId(null);
        return;
      }
      const edgeSnapshot = snapshot.edges.get(entry.rootEdgeId);
      if (!edgeSnapshot) {
        setSelectedEdgeId(null);
        return;
      }
      const childEdgeIds = snapshot.childrenByParent.get(edgeSnapshot.childNodeId) ?? [];
      if (childEdgeIds.length > 0) {
        setSelectedEdgeId(childEdgeIds[0]);
      } else {
        setSelectedEdgeId(null);
      }
    },
    [paneId, sessionStore, setSelectedEdgeId, snapshot]
  );

  return {
    setSelectedEdgeId,
    handleFocusEdge,
    handleClearFocus,
    handleNavigateHistory
  };
};
