import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {KeyboardEvent, MouseEvent} from 'react';

import type {EdgeId, NodeId, EdgeRecord} from '../types';
import type {VirtualizedNodeRow} from '../hooks/useVirtualizedNodes';
import {useVirtualizedNodes} from '../hooks/useVirtualizedNodes';
import {VirtualizedOutline} from './VirtualizedOutline';
import {NodeEditor} from './NodeEditor';
import {SelectionManager} from '../selection/selectionManager';
import type {SelectionSnapshot} from '../selection/selectionManager';
import {useYDoc} from '../hooks/yDocContext';
import {useCommandBus} from '../hooks/commandBusContext';
import {initializeCollections, createResolverFromDoc} from '../yjs/doc';

interface OutlinePaneProps {
  readonly rootId: NodeId;
  readonly className?: string;
}

interface DragState {
  readonly isDragging: boolean;
  readonly anchorEdgeId: EdgeId | null;
}

const timestamp = () => new Date().toISOString();

export const OutlinePane = ({rootId, className}: OutlinePaneProps) => {
  const doc = useYDoc();
  const bus = useCommandBus();
  const rows = useVirtualizedNodes({rootId, initialDepth: -1});
  const selectionManager = useMemo(() => new SelectionManager(doc), [doc]);
  const [selection, setSelection] = useState(() => selectionManager.getSelectionSnapshot());
  const [dragState, setDragState] = useState<DragState>({isDragging: false, anchorEdgeId: null});
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusRequest, setFocusRequest] = useState<{edgeId: EdgeId; position: number} | null>(null);
  const [rootSelected, setRootSelected] = useState(false);
  const [activeEdgeId, setActiveEdgeId] = useState<EdgeId | null>(null);
  const selectedEdgeIdSet = useMemo(() => new Set(selection.selectedEdgeIds), [selection.selectedEdgeIds]);

  useEffect(() => {
    const handleDocUpdate = () => {
      setSelection(selectionManager.getSelectionSnapshot());
    };

    doc.on('update', handleDocUpdate);
    return () => {
      doc.off('update', handleDocUpdate);
    };
  }, [doc, selectionManager]);

  useEffect(() => {
    if (!dragState.isDragging) {
      return undefined;
    }

    const endDrag = () => setDragState({isDragging: false, anchorEdgeId: null});
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, [dragState.isDragging]);

  const handleSelectionChange = useCallback((snapshot: SelectionSnapshot) => {
    setRootSelected(false);
    setSelection(snapshot);
  }, []);

  const restoreFocusAfterHistoryChange = useCallback(() => {
    const resolver = createResolverFromDoc(doc);
    const orderedEdges: EdgeRecord[] = [];
    const stack: Array<{nodeId: NodeId; viaEdge: EdgeRecord | null}> = [
      {nodeId: rootId, viaEdge: null}
    ];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      if (current.viaEdge) {
        orderedEdges.push(current.viaEdge);
      }

      const children = resolver(current.nodeId);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        stack.push({nodeId: child.childId, viaEdge: child});
      }
    }

    const edgeMap = new Map<EdgeId, EdgeRecord>();
    orderedEdges.forEach((edge) => edgeMap.set(edge.id, edge));

    const snapshot = selectionManager.getSelectionSnapshot();
    const ensureEdge = (edgeId: EdgeId | null) => (edgeId && edgeMap.has(edgeId) ? edgeId : null);

    const sanitizedSelected = snapshot.selectedEdgeIds.filter((edgeId) => edgeMap.has(edgeId));
    let nextFocusEdgeId = ensureEdge(snapshot.focusEdgeId);
    if (!nextFocusEdgeId && sanitizedSelected.length > 0) {
      nextFocusEdgeId = sanitizedSelected[sanitizedSelected.length - 1];
    }
    if (!nextFocusEdgeId) {
      nextFocusEdgeId = ensureEdge(snapshot.anchorEdgeId);
    }
    if (!nextFocusEdgeId && activeEdgeId && edgeMap.has(activeEdgeId)) {
      nextFocusEdgeId = activeEdgeId;
    }
    if (!nextFocusEdgeId) {
      const lastEdge = orderedEdges[orderedEdges.length - 1];
      if (lastEdge) {
        nextFocusEdgeId = lastEdge.id;
      }
    }

    if (nextFocusEdgeId) {
      const normalized = selectionManager.selectSingle(rootId, nextFocusEdgeId);
      handleSelectionChange(normalized);
      setActiveEdgeId(nextFocusEdgeId);
      setRootSelected(false);
      setFocusRequest({edgeId: nextFocusEdgeId, position: -1});
      return;
    }

    const cleared = selectionManager.clearSelection();
    handleSelectionChange(cleared);
    setActiveEdgeId(null);
    setRootSelected(true);
    setFocusRequest(null);
  }, [activeEdgeId, doc, handleSelectionChange, rootId, selectionManager]);

  const handleRowMouseDown = useCallback(
    (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => {
      const isTextAreaTarget = (event.target as HTMLElement | null)?.closest('textarea');
      if (!isTextAreaTarget) {
        event.preventDefault();
      }

      if (row.isRoot || !row.edge) {
        selectionManager.clearSelection();
        handleSelectionChange({anchorEdgeId: null, focusEdgeId: null, selectedEdgeIds: []});
        setRootSelected(true);
        setDragState({isDragging: false, anchorEdgeId: null});
        setActiveEdgeId(null);
        setFocusRequest(null);
        return;
      }

      let snapshot: SelectionSnapshot;
      if (event.shiftKey && selection.anchorEdgeId) {
        snapshot = selectionManager.selectRange(rootId, selection.anchorEdgeId, row.edge.id);
      } else if (event.metaKey || event.ctrlKey) {
        snapshot = selectionManager.toggleEdge(rootId, row.edge.id);
      } else {
        snapshot = selectionManager.selectSingle(rootId, row.edge.id);
      }

      handleSelectionChange(snapshot);
      setDragState({isDragging: true, anchorEdgeId: snapshot.anchorEdgeId ?? row.edge.id});
      setActiveEdgeId(row.edge.id);
      setFocusRequest({edgeId: row.edge.id, position: -1});
    },
    [handleSelectionChange, rootId, selection.anchorEdgeId, selectionManager, selection]
  );

  const handleRowMouseEnter = useCallback(
    (row: VirtualizedNodeRow) => {
      if (!dragState.isDragging || !dragState.anchorEdgeId || !row.edge) {
        return;
      }
      const snapshot = selectionManager.selectRange(rootId, dragState.anchorEdgeId, row.edge.id);
      handleSelectionChange(snapshot);
    },
    [dragState.anchorEdgeId, dragState.isDragging, handleSelectionChange, rootId, selectionManager]
  );

  const handleRowMouseUp = useCallback(() => {
    if (!dragState.isDragging) {
      return;
    }
    setDragState({isDragging: false, anchorEdgeId: dragState.anchorEdgeId});
  }, [dragState.anchorEdgeId, dragState.isDragging]);

  const handleContainerArrows = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 'next' : 'previous';
      const origin = selection.focusEdgeId ?? selection.anchorEdgeId ?? activeEdgeId;
      const snapshot = selectionManager.moveFocus(rootId, origin ?? null, direction);
      handleSelectionChange(snapshot);
      if (snapshot.focusEdgeId) {
        setFocusRequest({edgeId: snapshot.focusEdgeId, position: -1});
      }
      setRootSelected(false);
    },
    [activeEdgeId, handleSelectionChange, rootId, selection.focusEdgeId, selection.anchorEdgeId, selectionManager]
  );

  const edgeOrder = useMemo(() => {
    const order = new Map<EdgeId, number>();
    rows.forEach((row, index) => {
      if (row.edge) {
        order.set(row.edge.id, index);
      }
    });
    return order;
  }, [rows]);

  const applyIndentOutdent = useCallback(
    (direction: 'indent' | 'outdent') => {
      const edgesToModify = selection.selectedEdgeIds.length > 0
        ? Array.from(new Set(selection.selectedEdgeIds))
        : activeEdgeId
          ? [activeEdgeId]
          : [];

      const filtered = edgesToModify.filter((edgeId) => edgeOrder.has(edgeId));
      if (filtered.length === 0) {
        return false;
      }

      setRootSelected(false);
      filtered.sort((a, b) => (edgeOrder.get(a) ?? 0) - (edgeOrder.get(b) ?? 0));
      const time = timestamp();
      filtered.forEach((edgeId) => {
        bus.execute({
          kind: direction === 'indent' ? 'indent-node' : 'outdent-node',
          edgeId,
          timestamp: time
        });
      });

      setFocusRequest({edgeId: filtered[filtered.length - 1], position: -1});
      handleSelectionChange(selectionManager.getSelectionSnapshot());
      return true;
    },
    [activeEdgeId, bus, edgeOrder, handleSelectionChange, selection.selectedEdgeIds, selectionManager]
  );

  const handleBackspaceAtStart = useCallback(
    (edge: EdgeRecord) => {
      const {edges} = initializeCollections(doc);
      const siblings = edges.get(edge.parentId);
      if (!siblings) {
        return false;
      }

      const all = siblings.toArray();
      const index = all.findIndex((candidate) => candidate.id === edge.id);
      if (index <= 0) {
        return false;
      }

      const previousEdge = all[index - 1];
      const currentChildren = edges.get(edge.childId);
      const previousChildren = edges.get(previousEdge.childId);
      if (currentChildren && currentChildren.length > 0 && previousChildren && previousChildren.length > 0) {
        return false;
      }

      setRootSelected(false);

      const time = timestamp();
      bus.execute({kind: 'merge-node-into-previous', edgeId: edge.id, timestamp: time});
      const snapshot = selectionManager.selectSingle(rootId, previousEdge.id);
      handleSelectionChange(snapshot);
      setFocusRequest({edgeId: previousEdge.id, position: -1});
      return true;
    },
    [bus, doc, handleSelectionChange, rootId, selectionManager]
  );

  const handleDeleteSelection = useCallback(() => {
    const edgesToDelete = selection.selectedEdgeIds.length > 0
      ? Array.from(new Set(selection.selectedEdgeIds))
      : activeEdgeId
        ? [activeEdgeId]
        : [];

    const filtered = edgesToDelete.filter((edgeId) => edgeOrder.has(edgeId));
    if (filtered.length === 0) {
      return false;
    }

    if (filtered.length > 30 && !window.confirm('Delete the selected nodes?')) {
      return true;
    }

    setRootSelected(false);

    const time = timestamp();
    bus.execute({kind: 'delete-edges', edgeIds: filtered, timestamp: time});
    const snapshot = selectionManager.clearSelection();
    handleSelectionChange(snapshot);
    setFocusRequest(null);
    setActiveEdgeId(null);
    return true;
  }, [activeEdgeId, bus, edgeOrder, handleSelectionChange, selection.selectedEdgeIds, selectionManager]);

  const handleContainerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        applyIndentOutdent(event.shiftKey ? 'outdent' : 'indent');
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        handleContainerArrows(event);
        return;
      }

      const isModifier = event.ctrlKey || event.metaKey;
      if (event.key === 'Backspace' && event.shiftKey && isModifier) {
        event.preventDefault();
        handleDeleteSelection();
        return;
      }

      if (event.key.toLowerCase() === 'z' && isModifier) {
        event.preventDefault();
        if (event.shiftKey) {
          bus.redo();
        } else {
          bus.undo();
        }
        restoreFocusAfterHistoryChange();
      }
    },
    [
      applyIndentOutdent,
      bus,
      handleContainerArrows,
      handleDeleteSelection,
      restoreFocusAfterHistoryChange
    ]
  );

  useEffect(() => {
    if (!focusRequest) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const textarea = container.querySelector<HTMLTextAreaElement>(`[data-edge-id="${focusRequest.edgeId}"] textarea`);
    if (!textarea) {
      return;
    }

    const position = focusRequest.position < 0
      ? textarea.value.length
      : Math.max(0, Math.min(focusRequest.position, textarea.value.length));

    textarea.focus();
    textarea.setSelectionRange(position, position);
    setFocusRequest(null);
  }, [focusRequest, rows]);

  const handleNodeCreated = useCallback(
    ({edgeId}: {edgeId: EdgeId}) => {
      const snapshot = selectionManager.selectSingle(rootId, edgeId);
      handleSelectionChange(snapshot);
      setFocusRequest({edgeId, position: 0});
      setActiveEdgeId(edgeId);
    },
    [handleSelectionChange, rootId, selectionManager]
  );

  return (
    <div
      className={className}
      tabIndex={0}
      onKeyDown={handleContainerKeyDown}
      role="presentation"
      style={{outline: 'none'}}
      ref={containerRef}
    >
      <VirtualizedOutline
        rows={rows}
        rootSelected={rootSelected}
        selectedEdgeIds={selectedEdgeIdSet}
        renderNode={(row) => (
          <NodeEditor
            nodeId={row.node.id}
            edge={row.edge}
            onNodeCreated={handleNodeCreated}
            onBackspaceAtStart={row.edge ? handleBackspaceAtStart : undefined}
            onTabCommand={(edge, direction) => {
              if (!edge) {
                return false;
              }
              setActiveEdgeId(edge.id);
              return applyIndentOutdent(direction);
            }}
            onFocusEdge={(edgeId) => {
              setActiveEdgeId(edgeId);
              if (edgeId) {
                setRootSelected(false);
              }
            }}
          />
        )}
        onRowMouseDown={handleRowMouseDown}
        onRowMouseEnter={handleRowMouseEnter}
        onRowMouseUp={handleRowMouseUp}
      />
    </div>
  );
};
