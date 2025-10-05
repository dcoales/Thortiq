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
  useOutlineActivePaneId,
  useSearchIndex,
  useSearchQuery,
  useSearchCommands,
  useSearchResults
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

export {
  OutlineRowView,
  OUTLINE_ROW_TOGGLE_DIAMETER_REM,
  OUTLINE_ROW_BULLET_DIAMETER_REM,
  OUTLINE_ROW_LINE_HEIGHT_REM,
  OUTLINE_ROW_BOTTOM_PADDING_REM,
  OUTLINE_ROW_CONTROL_VERTICAL_OFFSET_REM,
  OUTLINE_ROW_GUIDELINE_SPACER_REM,
  OUTLINE_ROW_GUIDELINE_COLUMN_REM
} from "./outline/components/OutlineRowView";
export type { OutlineRowViewProps } from "./outline/components/OutlineRowView";

export { PresenceIndicators } from "./outline/components/PresenceIndicators";
export type { PresenceIndicatorsProps } from "./outline/components/PresenceIndicators";

export { OutlineVirtualList } from "./outline/OutlineVirtualList";
export type {
  OutlineVirtualListProps,
  OutlineVirtualRowRendererProps
} from "./outline/OutlineVirtualList";
