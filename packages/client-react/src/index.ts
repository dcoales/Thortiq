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

export {
  AuthProvider,
  useAuthActions,
  useAuthError,
  useAuthIsAuthenticated,
  useAuthIsAuthenticating,
  useAuthIsRegistering,
  useAuthMfaChallenge,
  useAuthPendingIdentifier,
  useAuthRegistrationPending,
  useAuthRecoveryState,
  useAuthRememberDevicePreference,
  useAuthSession,
  useAuthSessions,
  useAuthState,
  useAuthStore
} from "./auth";
export type { AuthActions, AuthProviderProps } from "./auth";
export {
  AccountRecoveryRequestForm,
  PasswordResetForm,
  GoogleSignInButton,
  AuthErrorNotice
} from "./auth";
export type { AuthErrorNoticeProps } from "./auth";

export { useOutlineRows } from "./outline/useOutlineRows";
export type { OutlineRow, OutlineRowsResult } from "./outline/useOutlineRows";

export { useOutlineSingletonNodes } from "./outline/useSingletonNodes";
export type { OutlineSingletonAssignments } from "./outline/useSingletonNodes";

export { usePaneSearch } from "./outline/usePaneSearch";
export type {
  PaneSearchController,
  PaneSearchSubmitResult,
  PaneSearchToggleTagOptions
} from "./outline/usePaneSearch";

export { usePaneOpener } from "./outline/usePaneOpener";
export type {
  UsePaneOpenerResult,
  WikiLinkActivationPayload,
  BulletActivationPayload
} from "./outline/usePaneOpener";

export { usePaneCloser } from "./outline/usePaneCloser";
export type { UsePaneCloserResult, UsePaneCloserOptions } from "./outline/usePaneCloser";

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
export type {
  OutlineRowViewProps,
  OutlineMirrorIndicatorClickPayload,
  OutlineDateClickPayload
} from "./outline/components/OutlineRowView";

export { PresenceIndicators } from "./outline/components/PresenceIndicators";
export type { PresenceIndicatorsProps } from "./outline/components/PresenceIndicators";

export { FloatingSelectionMenu } from "./outline/components/FloatingSelectionMenu";
export type {
  FloatingSelectionMenuProps,
  FloatingSelectionMenuRenderContext
} from "./outline/components/FloatingSelectionMenu";

export { SelectionFormattingMenu } from "./outline/components/SelectionFormattingMenu";
export type { SelectionFormattingMenuProps } from "./outline/components/SelectionFormattingMenu";
export { ColorPalettePopover } from "./outline/components/SelectionFormattingMenu";
export {
  DatePickerPopover
} from "./outline/components/DatePickerPopover";
export type { DatePickerPopoverProps } from "./outline/components/DatePickerPopover";

export { OutlineContextMenu } from "./outline/components/OutlineContextMenu";
export type { OutlineContextMenuProps } from "./outline/components/OutlineContextMenu";

export { OutlineVirtualList } from "./outline/OutlineVirtualList";
export type {
  OutlineVirtualListProps,
  OutlineVirtualRowRendererProps
} from "./outline/OutlineVirtualList";

export { PaneManager } from "./outline/PaneManager";
export type {
  PaneManagerProps,
  PaneRendererProps,
  PaneLayoutMode
} from "./outline/PaneManager";

export {
  PANE_HEADER_BASE_STYLE,
  PANE_HEADER_ACTIVE_STYLE
} from "./outline/paneStyles";

export { useOutlineContextMenu } from "./outline/contextMenu/useOutlineContextMenu";
export type {
  OutlineContextMenuController,
  OutlineContextMenuOpenRequest,
  OutlineContextMenuState
} from "./outline/contextMenu/useOutlineContextMenu";
export type {
  OutlineContextMenuEvent,
  OutlineSingletonRole,
  OutlineContextMenuMoveMode
} from "./outline/contextMenu/contextMenuEvents";
export type {
  OutlineContextMenuFormattingActionRequest,
  OutlineContextMenuColorPaletteRequest
} from "./outline/contextMenu/createOutlineContextMenuDescriptors";
