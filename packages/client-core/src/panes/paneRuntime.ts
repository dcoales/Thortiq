import type { PaneRuntimeState } from "./paneTypes";

/**
 * Creates a runtime state snapshot for the given pane, ensuring default values are populated when
 * no previous record exists. The helper keeps runtime metadata consistent across view/controller
 * layers without leaking persistence concerns into UI code.
 */
export const ensurePaneRuntimeState = (
  paneId: string,
  previous: PaneRuntimeState | null | undefined
): PaneRuntimeState => ({
  paneId,
  scrollTop: previous?.scrollTop ?? 0,
  widthRatio: previous?.widthRatio ?? null,
  lastFocusedEdgeId: previous?.lastFocusedEdgeId ?? null,
  virtualizerVersion: previous?.virtualizerVersion ?? 0
});
