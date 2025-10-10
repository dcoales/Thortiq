import type {
  EdgeId,
  OutlineContextMenuSelectionSnapshot,
  NodeId
} from "@thortiq/client-core";

export type OutlineSingletonRole = "inbox" | "journal";

export interface OutlineContextMenuSingletonReassignmentEvent {
  readonly type: "requestSingletonReassignment";
  readonly role: OutlineSingletonRole;
  readonly currentNodeId: NodeId;
  readonly nextNodeId: NodeId;
  readonly confirm: () => void;
}

export interface OutlineContextMenuMoveRequestEvent {
  readonly type: "requestMoveDialog";
  readonly anchor: { readonly x: number; readonly y: number };
  readonly paneId: string;
  readonly triggerEdgeId: EdgeId;
  readonly selection: OutlineContextMenuSelectionSnapshot;
}

export type OutlineContextMenuEvent =
  | OutlineContextMenuSingletonReassignmentEvent
  | OutlineContextMenuMoveRequestEvent;
