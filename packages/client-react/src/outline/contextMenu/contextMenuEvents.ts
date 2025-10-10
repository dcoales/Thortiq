import type { NodeId } from "@thortiq/client-core";

export type OutlineSingletonRole = "inbox" | "journal";

export interface OutlineContextMenuSingletonReassignmentEvent {
  readonly type: "requestSingletonReassignment";
  readonly role: OutlineSingletonRole;
  readonly currentNodeId: NodeId;
  readonly nextNodeId: NodeId;
  readonly confirm: () => void;
}

export type OutlineContextMenuEvent = OutlineContextMenuSingletonReassignmentEvent;
