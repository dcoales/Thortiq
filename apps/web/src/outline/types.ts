/**
 * Shared outline UI types used to coordinate between container hooks, drag logic, and
 * presentational components. These types intentionally avoid any React-specific structures so
 * they can be reused across platforms while keeping identifiers stable, in line with AGENTS.md.
 */
import type { EdgeId } from "@thortiq/client-core";
import type { OutlineRow as SharedOutlineRow } from "@thortiq/client-react";
import type { PendingCursorRequest } from "./ActiveNodeEditor";

export interface SelectionRange {
  readonly anchorEdgeId: EdgeId;
  readonly focusEdgeId: EdgeId;
}

export type PendingCursor = PendingCursorRequest & { readonly edgeId: EdgeId };

export type OutlineRow = SharedOutlineRow;
