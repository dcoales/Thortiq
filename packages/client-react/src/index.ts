export {
  OutlineProvider,
  useOutlineStore,
  useOutlineSnapshot,
  useOutlinePresence,
  useSyncContext,
  useAwarenessIndicatorsEnabled,
  useSyncDebugLoggingEnabled,
  useSyncStatus,
  useOutlineSessionStore,
  useOutlineSessionState,
  useOutlinePaneState,
  useOutlinePaneIds,
  useOutlineActivePaneId
} from "./outline/OutlineProvider";

export type { OutlineProviderProps } from "./outline/OutlineProvider";

export { useOutlineRows } from "./outline/useOutlineRows";
export type { OutlineRow, OutlineRowsResult } from "./outline/useOutlineRows";

export { useOutlineSelection } from "./outline/useOutlineSelection";
export type { OutlineSelectionState, SelectionRange } from "./outline/useOutlineSelection";

export { useOutlineDragAndDrop } from "./outline/useOutlineDragAndDrop";
export type {
  ActiveDrag,
  DragIntent,
  DropIndicatorDescriptor,
  OutlineDragAndDropHandlers,
  OutlineDragGuidelinePlan,
  OutlinePendingCursor
} from "./outline/useOutlineDragAndDrop";
