import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type EdgeId,
  type NodeId,
  type OutlineDoc,
  type OutlineContextMenuExecutionContext,
  type OutlineContextMenuNode,
  type OutlineContextMenuSelectionSnapshot
} from "@thortiq/client-core";
import type { OutlineCommandId } from "@thortiq/client-core";

import type { OutlineRow } from "../useOutlineRows";
import type { SelectionRange } from "../useOutlineSelection";
import {
  createOutlineContextMenuDescriptors,
  type OutlineContextMenuEnvironment,
  type OutlineContextMenuFormattingActionRequest
} from "./createOutlineContextMenuDescriptors";
import type { OutlineContextMenuEvent } from "./contextMenuEvents";

export interface OutlineContextMenuState {
  readonly anchor: { readonly x: number; readonly y: number };
  readonly nodes: readonly OutlineContextMenuNode[];
  readonly executionContext: OutlineContextMenuExecutionContext;
}

export interface OutlineContextMenuOpenRequest {
  readonly anchor: { readonly x: number; readonly y: number };
  readonly triggerEdgeId: EdgeId;
  readonly selectionOverride?: readonly EdgeId[];
}

export interface UseOutlineContextMenuOptions {
  readonly outline: OutlineDoc;
  readonly origin: unknown;
  readonly paneId: string;
  readonly rows: readonly OutlineRow[];
  readonly rowMap: ReadonlyMap<EdgeId, OutlineRow>;
  readonly orderedSelectedEdgeIds: readonly EdgeId[];
  readonly selectionRange: SelectionRange | null;
  readonly primarySelectedEdgeId: EdgeId | null;
  readonly handleCommand: (commandId: OutlineCommandId) => boolean;
  readonly handleDeleteSelection: () => boolean;
  readonly emitEvent?: (event: OutlineContextMenuEvent) => void;
  readonly applySelectionSnapshot?: (snapshot: OutlineContextMenuSelectionSnapshot) => void;
  readonly runFormattingAction?: (request: OutlineContextMenuFormattingActionRequest) => void;
  readonly requestPendingCursor?: (request: {
    readonly edgeId: EdgeId;
    readonly clientX: number;
    readonly clientY: number;
  }) => void;
}

export interface OutlineContextMenuController {
  readonly state: OutlineContextMenuState | null;
  readonly open: (request: OutlineContextMenuOpenRequest) => void;
  readonly close: () => void;
}

const buildSelectionSnapshot = (
  effectiveEdgeIds: readonly EdgeId[],
  triggerEdgeId: EdgeId,
  rowMap: ReadonlyMap<EdgeId, OutlineRow>,
  selectionRange: SelectionRange | null,
  primarySelectedEdgeId: EdgeId | null
): OutlineContextMenuSelectionSnapshot => {
  const orderedEdgeIds = effectiveEdgeIds.length > 0 ? [...effectiveEdgeIds] : [triggerEdgeId];
  const primaryEdgeCandidate = orderedEdgeIds.includes(triggerEdgeId)
    ? triggerEdgeId
    : primarySelectedEdgeId && orderedEdgeIds.includes(primarySelectedEdgeId)
      ? primarySelectedEdgeId
      : orderedEdgeIds[orderedEdgeIds.length - 1] ?? triggerEdgeId;
  const firstEdgeId = orderedEdgeIds[0] ?? triggerEdgeId;
  const lastEdgeId = orderedEdgeIds[orderedEdgeIds.length - 1] ?? triggerEdgeId;

  const canonicalEdgeIds: EdgeId[] = [];
  const nodeIds: NodeId[] = [];
  const canonicalSeen = new Set<EdgeId>();
  const nodeSeen = new Set<NodeId>();

  orderedEdgeIds.forEach((edgeId) => {
    const row = rowMap.get(edgeId);
    if (!row) {
      return;
    }
    const canonicalEdgeId = row.canonicalEdgeId ?? edgeId;
    if (!canonicalSeen.has(canonicalEdgeId)) {
      canonicalSeen.add(canonicalEdgeId);
      canonicalEdgeIds.push(canonicalEdgeId);
    }
    if (!nodeSeen.has(row.nodeId)) {
      nodeSeen.add(row.nodeId);
      nodeIds.push(row.nodeId);
    }
  });

  const resolveRangeEdge = (edgeId: EdgeId | null): EdgeId | null => {
    if (!edgeId) {
      return null;
    }
    return orderedEdgeIds.includes(edgeId) ? edgeId : null;
  };

  const anchorEdgeId = resolveRangeEdge(selectionRange ? selectionRange.anchorEdgeId : null) ?? firstEdgeId;
  const focusEdgeId = resolveRangeEdge(selectionRange ? selectionRange.focusEdgeId : null) ?? lastEdgeId;

  if (canonicalEdgeIds.length === 0) {
    const triggerRow = rowMap.get(triggerEdgeId);
    if (triggerRow) {
      canonicalEdgeIds.push(triggerRow.canonicalEdgeId ?? triggerEdgeId);
    } else {
      canonicalEdgeIds.push(triggerEdgeId);
    }
  }

  if (nodeIds.length === 0) {
    const triggerRow = rowMap.get(triggerEdgeId);
    if (triggerRow) {
      nodeIds.push(triggerRow.nodeId);
    }
  }

  return {
    primaryEdgeId: primaryEdgeCandidate,
    orderedEdgeIds,
    canonicalEdgeIds: canonicalEdgeIds.length > 0 ? canonicalEdgeIds : [triggerEdgeId],
    nodeIds: nodeIds.length > 0 ? nodeIds : [`node-${triggerEdgeId}` as NodeId],
    anchorEdgeId,
    focusEdgeId
  };
};

export const useOutlineContextMenu = ({
  outline,
  origin,
  paneId,
  rows,
  rowMap,
  orderedSelectedEdgeIds,
  selectionRange,
  primarySelectedEdgeId,
  handleCommand,
  handleDeleteSelection,
  emitEvent,
  applySelectionSnapshot,
  runFormattingAction,
  requestPendingCursor
}: UseOutlineContextMenuOptions): OutlineContextMenuController => {
  const [state, setState] = useState<OutlineContextMenuState | null>(null);

  const handleCommandRef = useRef(handleCommand);
  const handleDeleteSelectionRef = useRef(handleDeleteSelection);

  useEffect(() => {
    handleCommandRef.current = handleCommand;
  }, [handleCommand]);

  useEffect(() => {
    handleDeleteSelectionRef.current = handleDeleteSelection;
  }, [handleDeleteSelection]);

  const rowsByEdgeId = useMemo(() => {
    if (rowMap.size > 0) {
      return rowMap;
    }
    const map = new Map<EdgeId, OutlineRow>();
    rows.forEach((row) => {
      map.set(row.edgeId, row);
    });
    return map as ReadonlyMap<EdgeId, OutlineRow>;
  }, [rowMap, rows]);

  const close = useCallback(() => {
    setState(null);
  }, []);

  const emitContextMenuEvent = useCallback(
    (event: OutlineContextMenuEvent) => {
      emitEvent?.(event);
    },
    [emitEvent]
  );

  const open = useCallback(
    (request: OutlineContextMenuOpenRequest) => {
      const selectionEdgeIds = request.selectionOverride && request.selectionOverride.length > 0
        ? request.selectionOverride
        : orderedSelectedEdgeIds;
      const snapshot = buildSelectionSnapshot(
        selectionEdgeIds,
        request.triggerEdgeId,
        rowsByEdgeId,
        selectionRange,
        primarySelectedEdgeId
      );

      const environment: OutlineContextMenuEnvironment = {
        outline,
        origin,
        selection: snapshot,
        handleCommand: (commandId) => handleCommandRef.current(commandId),
        handleDeleteSelection: () => handleDeleteSelectionRef.current(),
        emitEvent: emitContextMenuEvent,
        anchor: request.anchor,
        paneId,
        triggerEdgeId: request.triggerEdgeId,
        applySelectionSnapshot,
        runFormattingAction,
        requestPendingCursor
      };
      const nodes = createOutlineContextMenuDescriptors(environment);
      const executionContext: OutlineContextMenuExecutionContext = {
        outline,
        origin,
        selection: snapshot,
        source: {
          paneId,
          triggerEdgeId: request.triggerEdgeId
        }
      };

      const hasEnabledCommand = nodes.some((node) => {
        if (node.type !== "command") {
          return false;
        }
        return node.isEnabled ? node.isEnabled(executionContext) : true;
      });

      if (!hasEnabledCommand) {
        return;
      }

      setState({
        anchor: request.anchor,
        nodes,
        executionContext
      });
    },
    [
      emitContextMenuEvent,
      orderedSelectedEdgeIds,
      origin,
      outline,
      paneId,
      primarySelectedEdgeId,
      rowsByEdgeId,
      selectionRange,
      applySelectionSnapshot,
      runFormattingAction,
      requestPendingCursor
    ]
  );

  return {
    state,
    open,
    close
  };
};
