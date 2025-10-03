/**
 * Shared outline UI types used to coordinate between container hooks, drag logic, and
 * presentational components. These types intentionally avoid any React-specific structures so
 * they can be reused across platforms while keeping identifiers stable, in line with AGENTS.md.
 */
import type {
  OutlineRow as SharedOutlineRow,
  OutlinePendingCursor,
  SelectionRange as SharedSelectionRange
} from "@thortiq/client-react";

export type SelectionRange = SharedSelectionRange;

export type PendingCursor = OutlinePendingCursor;

export type OutlineRow = SharedOutlineRow;
