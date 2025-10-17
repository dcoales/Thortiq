import { useCallback } from "react";

import { closePane } from "@thortiq/client-core";

import { useOutlineSessionStore, useOutlineStore } from "./OutlineProvider";

export interface UsePaneCloserOptions {
  readonly onPaneClosed?: (paneId: string, nextActivePaneId: string) => void;
}

export type UsePaneCloserResult = (paneId: string) => boolean;

export const usePaneCloser = (options: UsePaneCloserOptions = {}): UsePaneCloserResult => {
  const sessionStore = useOutlineSessionStore();
  const outlineStore = useOutlineStore();
  const { onPaneClosed } = options;

  return useCallback<UsePaneCloserResult>(
    (paneId: string) => {
      let didClose = false;
      let nextActivePaneId = sessionStore.getState().activePaneId;

      sessionStore.update((state) => {
        const result = closePane(state, paneId);
        if (!result.didClose) {
          return state;
        }
        didClose = true;
        nextActivePaneId = result.nextActivePaneId;
        return result.state;
      });

      if (!didClose) {
        return false;
      }

      outlineStore.updatePaneRuntimeState(paneId, () => null);
      outlineStore.clearPaneSearch(paneId);
      onPaneClosed?.(paneId, nextActivePaneId);
      return true;
    },
    [onPaneClosed, outlineStore, sessionStore]
  );
};
