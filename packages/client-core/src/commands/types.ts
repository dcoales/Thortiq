import type {
  EdgeId,
  EdgeRecord,
  HtmlContent,
  IsoTimestamp,
  NodeAttributes,
  NodeId,
  NodeRecord,
  SessionState,
  TaskMetadata
} from '../types';

export interface CreateNodeCommand {
  readonly kind: 'create-node';
  readonly node: NodeRecord;
  readonly edge: EdgeRecord;
  readonly initialText?: string;
}

export interface UpdateNodeCommand {
  readonly kind: 'update-node';
  readonly nodeId: NodeId;
  readonly patch: Readonly<{
    html?: HtmlContent;
    tags?: readonly string[];
    attributes?: NodeAttributes;
    task?: TaskMetadata | undefined;
    updatedAt: IsoTimestamp;
  }>;
}

export interface DeleteNodeCommand {
  readonly kind: 'delete-node';
  readonly nodeId: NodeId;
  readonly timestamp: IsoTimestamp;
}

export interface MoveNodeCommand {
  readonly kind: 'move-node';
  readonly edgeId: EdgeId;
  readonly targetParentId: NodeId;
  readonly targetOrdinal?: number;
  readonly timestamp: IsoTimestamp;
}

export interface SetEdgeCollapsedCommand {
  readonly kind: 'set-edge-collapsed';
  readonly edgeId: EdgeId;
  readonly collapsed: boolean;
  readonly timestamp: IsoTimestamp;
}

export interface IndentNodeCommand {
  readonly kind: 'indent-node';
  readonly edgeId: EdgeId;
  readonly timestamp: IsoTimestamp;
}

export interface OutdentNodeCommand {
  readonly kind: 'outdent-node';
  readonly edgeId: EdgeId;
  readonly timestamp: IsoTimestamp;
}

export interface MergeNodeIntoPreviousCommand {
  readonly kind: 'merge-node-into-previous';
  readonly edgeId: EdgeId;
  readonly timestamp: IsoTimestamp;
}

export interface DeleteEdgesCommand {
  readonly kind: 'delete-edges';
  readonly edgeIds: readonly EdgeId[];
  readonly timestamp: IsoTimestamp;
}

export interface UpsertSessionCommand {
  readonly kind: 'upsert-session';
  readonly session: SessionState;
}

export type Command =
  | CreateNodeCommand
  | UpdateNodeCommand
  | DeleteNodeCommand
  | MoveNodeCommand
  | SetEdgeCollapsedCommand
  | IndentNodeCommand
  | OutdentNodeCommand
  | MergeNodeIntoPreviousCommand
  | DeleteEdgesCommand
  | UpsertSessionCommand;
