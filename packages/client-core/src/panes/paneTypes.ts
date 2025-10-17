/**
 * Shared pane state contracts.
 *
 * `PaneState` mirrors the persisted session shape so that higher layers can treat session and
 * runtime data uniformly. Runtime-only details (scroll position, width preferences, virtualizer
 * hints) live in `PaneRuntimeState` so we never serialise them into the session store or
 * UndoManager history.
 */
import type { SessionPaneState, SessionPaneSearchState } from "@thortiq/sync-core";
import type { EdgeId } from "../ids";

export type PaneState = SessionPaneState;
export type PaneSearchState = SessionPaneSearchState;

export interface PaneRuntimeState {
  readonly paneId: string;
  readonly scrollTop: number;
  readonly widthRatio: number | null;
  readonly lastFocusedEdgeId: EdgeId | null;
  readonly virtualizerVersion: number;
  readonly tasksCollapsedSections?: ReadonlySet<string>;
  readonly tasksCollapsedDays?: ReadonlySet<string>;
}

export interface PaneViewState {
  readonly pane: PaneState;
  readonly runtime: PaneRuntimeState | null;
}
