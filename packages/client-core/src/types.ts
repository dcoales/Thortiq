export type IsoTimestamp = string;
export type HtmlContent = string;

export type NodeId = string;
export type EdgeId = string;
export type PaneId = string;
export type SessionId = string;
export type TaskId = string;
export type UserId = string;

export interface Timestamped {
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface NodeAttributes {
  readonly [key: string]: string;
}

export interface TaskMetadata {
  readonly isDone: boolean;
  readonly doneAt?: IsoTimestamp | null;
  readonly dueAt?: IsoTimestamp | null;
  readonly assignedTo?: UserId | null;
}

export interface NodeRecord extends Timestamped {
  readonly id: NodeId;
  readonly html: HtmlContent;
  readonly tags: readonly string[];
  readonly attributes: NodeAttributes;
  readonly task?: TaskMetadata;
}

export type EdgeRole = 'primary' | 'mirror';

export interface EdgeRecord extends Timestamped {
  readonly id: EdgeId;
  readonly parentId: NodeId;
  readonly childId: NodeId;
  readonly role: EdgeRole;
  readonly collapsed: boolean;
  readonly ordinal: number;
  readonly selected: boolean;
}

export type PaneKind = 'outline' | 'tasks';

export interface PaneFilters {
  readonly tagIds?: readonly string[];
  readonly showCompletedTasks?: boolean;
  readonly searchTerm?: string;
}

export type PaneFocusMode = 'default' | 'focused-node';

export interface PaneLayoutState {
  readonly widthRatio: number;
  readonly isSidePanelOpen: boolean;
}

export interface SelectionState {
  readonly anchorEdgeId: EdgeId | null;
  readonly focusEdgeId: EdgeId | null;
  readonly selectedEdgeIds: readonly EdgeId[];
  readonly lastChangedAt: IsoTimestamp;
}

export interface PaneState extends Timestamped {
  readonly id: PaneId;
  readonly kind: PaneKind;
  readonly rootNodeId: NodeId;
  readonly focusMode: PaneFocusMode;
  readonly layout: PaneLayoutState;
  readonly selection: SelectionState;
  readonly filters?: PaneFilters;
}

export interface SessionState extends Timestamped {
  readonly id: SessionId;
  readonly name: string;
  readonly paneOrder: readonly PaneId[];
  readonly panes: Readonly<Record<PaneId, PaneState>>;
  readonly activePaneId: PaneId | null;
}

export interface TaskViewModel {
  readonly id: TaskId;
  readonly nodeId: NodeId;
  readonly sourcePaneId: PaneId | null;
  readonly metadata: TaskMetadata;
}

export interface UserProfile {
  readonly id: UserId;
  readonly displayName: string;
  readonly email?: string;
  readonly avatarUrl?: string;
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface UserSettings {
  readonly theme: ThemePreference;
  readonly locale: string;
  readonly spellcheckEnabled: boolean;
  readonly experimentalFeatures?: readonly string[];
}

export interface UserMetadata {
  readonly profile: UserProfile;
  readonly settings: UserSettings;
  readonly lastSyncedAt?: IsoTimestamp | null;
}

export interface OutlineChildResolver {
  (parentId: NodeId): readonly EdgeRecord[];
}
