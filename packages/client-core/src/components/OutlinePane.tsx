import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {DragEvent as ReactDragEvent, KeyboardEvent, MouseEvent} from 'react';

import type {EdgeId, NodeId, EdgeRecord, NodeRecord} from '../types';
import type {VirtualizedNodeRow} from '../virtualization/outlineRows';
import {useOutlineRowsSnapshot} from '../hooks/useOutlineRowsSnapshot';
import {VirtualizedOutline, type DropIndicator, type RenderRowContext} from './VirtualizedOutline';
import {NodeEditor} from './NodeEditor';
import {SelectionManager} from '../selection/selectionManager';
import type {SelectionSnapshot} from '../selection/selectionManager';
import {useYDoc} from '../hooks/yDocContext';
import {useCommandBus} from '../hooks/commandBusContext';
import {initializeCollections, createResolverFromDoc} from '../yjs/doc';
import {htmlToPlainText} from '../utils/text';
import type {MoveNodeCommand} from '../commands/types';

interface OutlinePaneProps {
  readonly rootId: NodeId;
  readonly className?: string;
}

interface DragState {
  readonly isDragging: boolean;
  readonly anchorEdgeId: EdgeId | null;
}

interface ActiveDragContext {
  readonly edgeIds: readonly EdgeId[];
  readonly edges: readonly EdgeRecord[];
  readonly blockedParentIds: ReadonlySet<NodeId>;
}

type DropTarget =
  | {kind: 'sibling'; referenceEdgeId: EdgeId; parentId: NodeId}
  | {kind: 'child'; parentId: NodeId};

interface DropState {
  readonly indicator: DropIndicator;
  readonly target: DropTarget;
}

type EdgeLookup = ReadonlyMap<EdgeId, {edge: EdgeRecord; node: NodeRecord}>;

type DropZoneDescriptor =
  | {kind: 'sibling'; edge: EdgeRecord}
  | {kind: 'child'; nodeId: NodeId};

const INDENT_WIDTH = 18;
const BULLET_SIZE = 14;

const timestamp = () => new Date().toISOString();

export const OutlinePane = ({rootId, className}: OutlinePaneProps) => {
  const doc = useYDoc();
  const bus = useCommandBus();
  const rowsSnapshot = useOutlineRowsSnapshot({rootId, initialDepth: -1});
  const selectionManager = useMemo(() => new SelectionManager(doc), [doc]);
  const [selection, setSelection] = useState(() => selectionManager.getSelectionSnapshot());
  const [dragState, setDragState] = useState<DragState>({isDragging: false, anchorEdgeId: null});
  const [dragContext, setDragContext] = useState<ActiveDragContext | null>(null);
  const [dropState, setDropState] = useState<DropState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const [focusRequest, setFocusRequest] = useState<{edgeId: EdgeId; position: number; requestId: number} | null>(null);
  const focusSequenceRef = useRef(0);
  const [rootSelected, setRootSelected] = useState(false);
  const [activeEdgeId, setActiveEdgeId] = useState<EdgeId | null>(null);
  const selectedEdgeIdSet = useMemo(() => new Set(selection.selectedEdgeIds), [selection.selectedEdgeIds]);
  const draggingEdgeIdSet = useMemo(() => new Set(dragContext?.edgeIds ?? []), [dragContext]);

  const edgeLookup: EdgeLookup = useMemo(() => {
    const pairs: Array<[EdgeId, {edge: EdgeRecord; node: NodeRecord}]> = [];
    for (const row of rowsSnapshot.rows) {
      if (!row.edge) {
        continue;
      }
      pairs.push([row.edge.id, {edge: row.edge, node: row.node}]);
    }
    return new Map(pairs);
  }, [rowsSnapshot.rows]);

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
    if (typeof document === 'undefined') {
      return undefined;
    }
    const preview = document.createElement('div');
    preview.style.position = 'fixed';
    preview.style.top = '0';
    preview.style.left = '0';
    preview.style.width = '32px';
    preview.style.height = '32px';
    preview.style.borderRadius = '16px';
    preview.style.background = 'rgba(70, 70, 70, 0.85)';
    preview.style.color = '#fff';
    preview.style.display = 'none';
    preview.style.alignItems = 'center';
    preview.style.justifyContent = 'center';
    preview.style.fontFamily = 'sans-serif';
    preview.style.fontSize = '14px';
    preview.style.pointerEvents = 'none';
    dragPreviewRef.current = preview;
    document.body.appendChild(preview);
    return () => {
      document.body.removeChild(preview);
      dragPreviewRef.current = null;
    };
  }, []);

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

  const issueFocusRequest = useCallback((edgeId: EdgeId, position: number) => {
    focusSequenceRef.current += 1;
    setFocusRequest({edgeId, position, requestId: focusSequenceRef.current});
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
      issueFocusRequest(nextFocusEdgeId, -1);
      return;
    }

    const cleared = selectionManager.clearSelection();
    handleSelectionChange(cleared);
    setActiveEdgeId(null);
    setRootSelected(true);
    setFocusRequest(null);
  }, [activeEdgeId, doc, handleSelectionChange, issueFocusRequest, rootId, selectionManager]);

  const handleRowMouseDown = useCallback(
    (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => {
      const dragHandle = (event.target as HTMLElement | null)?.closest('[data-role="drag-handle"]');
      if (dragHandle) {
        setDragState({isDragging: false, anchorEdgeId: null});
        return;
      }

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
      issueFocusRequest(row.edge.id, -1);
    },
    [
      handleSelectionChange,
      issueFocusRequest,
      rootId,
      selection.anchorEdgeId,
      selectionManager,
      selection
    ]
  );

  const handleRowMouseEnter = useCallback(
    (row: VirtualizedNodeRow) => {
      if (!dragState.isDragging || dragContext || !dragState.anchorEdgeId || !row.edge) {
        return;
      }
      const snapshot = selectionManager.selectRange(rootId, dragState.anchorEdgeId, row.edge.id);
      handleSelectionChange(snapshot);
    },
    [
      dragContext,
      dragState.anchorEdgeId,
      dragState.isDragging,
      handleSelectionChange,
      rootId,
      selectionManager
    ]
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
        issueFocusRequest(snapshot.focusEdgeId, -1);
      }
      setRootSelected(false);
    },
    [
      activeEdgeId,
      handleSelectionChange,
      issueFocusRequest,
      rootId,
      selection.focusEdgeId,
      selection.anchorEdgeId,
      selectionManager
    ]
  );

  const edgeOrder = useMemo(() => new Map(rowsSnapshot.edgeToIndex.entries()), [rowsSnapshot]);

  const showDragPreview = useCallback((count: number) => {
    const preview = dragPreviewRef.current;
    if (!preview) {
      return;
    }
    preview.textContent = count.toString();
    preview.style.display = 'flex';
  }, []);

  const hideDragPreview = useCallback(() => {
    const preview = dragPreviewRef.current;
    if (!preview) {
      return;
    }
    preview.style.display = 'none';
    preview.textContent = '';
  }, []);

  const buildBlockedParentIds = useCallback(
    (edgesToMove: readonly EdgeRecord[]) => {
      const resolver = createResolverFromDoc(doc);
      const blocked = new Set<NodeId>();
      const stack: NodeId[] = [];
      edgesToMove.forEach((edge) => {
        stack.push(edge.childId);
      });
      while (stack.length > 0) {
        const currentId = stack.pop();
        if (!currentId || blocked.has(currentId)) {
          continue;
        }
        blocked.add(currentId);
        const children = resolver(currentId);
        for (const child of children) {
          stack.push(child.childId);
        }
      }
      return blocked;
    },
    [doc]
  );

  const getChildCount = useCallback(
    (parentId: NodeId) => {
      const {edges} = initializeCollections(doc);
      const childEdges = edges.get(parentId);
      return childEdges ? childEdges.length : 0;
    },
    [doc]
  );

  const clearDragArtifacts = useCallback(() => {
    hideDragPreview();
    setDropState(null);
    setDragContext(null);
  }, [hideDragPreview]);

  const resolveDropTarget = useCallback((descriptor: DropZoneDescriptor): DropTarget | null => {
    if (descriptor.kind === 'sibling') {
      return {
        kind: 'sibling',
        referenceEdgeId: descriptor.edge.id,
        parentId: descriptor.edge.parentId
      };
    }
    if (descriptor.kind === 'child') {
      return {kind: 'child', parentId: descriptor.nodeId};
    }
    return null;
  }, []);

  const finalizeDrop = useCallback(
    (target: DropTarget) => {
      if (!dragContext) {
        return;
      }

      const movingEdges = [...dragContext.edges].sort((a, b) => (edgeOrder.get(a.id) ?? 0) - (edgeOrder.get(b.id) ?? 0));
      if (movingEdges.length === 0) {
        clearDragArtifacts();
        return;
      }

      let baseIndex: number | null;
      if (target.kind === 'sibling') {
        const reference = edgeLookup.get(target.referenceEdgeId);
        baseIndex = reference ? reference.edge.ordinal + 1 : null;
      } else {
        baseIndex = 0;
      }

      if (baseIndex === null) {
        clearDragArtifacts();
        return;
      }

      let insertionIndex = baseIndex;
      let allNoOp = true;
      const time = timestamp();
      const commands: MoveNodeCommand[] = [];

      for (const edge of movingEdges) {
        let targetIndex = insertionIndex;
        if (edge.parentId === target.parentId && edge.ordinal < targetIndex) {
          targetIndex -= 1;
          insertionIndex -= 1;
        }

        if (!(edge.parentId === target.parentId && edge.ordinal === targetIndex)) {
          allNoOp = false;
        }

        commands.push({
          kind: 'move-node',
          edgeId: edge.id,
          targetParentId: target.parentId,
          targetOrdinal: targetIndex,
          timestamp: time
        });

        insertionIndex = targetIndex + 1;
      }

      if (allNoOp || commands.length === 0) {
        clearDragArtifacts();
        return;
      }

      try {
        bus.executeAll(commands);
      } catch (error) {
        clearDragArtifacts();
        // eslint-disable-next-line no-alert
        window.alert((error as Error).message);
        return;
      }

      clearDragArtifacts();
      const firstMoved = commands[0];
      if (firstMoved) {
        setActiveEdgeId(firstMoved.edgeId);
        issueFocusRequest(firstMoved.edgeId, -1);
      }
      handleSelectionChange(selectionManager.getSelectionSnapshot());
    },
    [
      bus,
      clearDragArtifacts,
      dragContext,
      edgeLookup,
      edgeOrder,
      getChildCount,
      handleSelectionChange,
      issueFocusRequest,
      selectionManager
    ]
  );

  const handleDropZoneDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>, descriptor: DropZoneDescriptor) => {
      if (!dragContext) {
        return;
      }
      const target = resolveDropTarget(descriptor);
      if (!target) {
        return;
      }

      if (dragContext.blockedParentIds.has(target.parentId)) {
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'none';
        }
        setDropState(null);
        return;
      }

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      event.preventDefault();

      const element = event.currentTarget as HTMLElement;
      const tree = treeRef.current;
      if (!tree) {
        return;
      }

      const elementRect = element.getBoundingClientRect();
      const treeRect = tree.getBoundingClientRect();
      const left = Math.max(0, elementRect.left - treeRect.left);
      const top = elementRect.bottom - treeRect.top;
      const width = Math.max(0, treeRect.width - left);

      setDropState((current) => {
        const nextIndicator: DropIndicator = {left, top, width};
        if (current) {
          const sameTarget =
            current.target.kind === target.kind &&
            current.target.parentId === target.parentId &&
            (target.kind !== 'sibling'
              ? current.target.kind !== 'sibling'
              : current.target.kind === 'sibling' &&
                current.target.referenceEdgeId === target.referenceEdgeId);

          if (
            sameTarget &&
            Math.abs(current.indicator.left - left) < 0.5 &&
            Math.abs(current.indicator.top - top) < 0.5 &&
            Math.abs(current.indicator.width - width) < 0.5
          ) {
            return current;
          }
        }
        return {indicator: nextIndicator, target};
      });
    },
    [dragContext, resolveDropTarget]
  );

  const handleDropZoneDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>, descriptor: DropZoneDescriptor) => {
      if (!dragContext) {
        return;
      }
      const target = resolveDropTarget(descriptor);
      if (!target) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (dragContext.blockedParentIds.has(target.parentId)) {
        clearDragArtifacts();
        return;
      }

      finalizeDrop(target);
    },
    [clearDragArtifacts, dragContext, finalizeDrop, resolveDropTarget]
  );

  const handleDragStart = useCallback(
    (row: VirtualizedNodeRow, event: ReactDragEvent<HTMLButtonElement>) => {
      if (!row.edge) {
        event.preventDefault();
        return;
      }

      setDragState({isDragging: false, anchorEdgeId: null});

      const parentId = row.edge.parentId;
      const edgesToMove: EdgeRecord[] = [];
      const seen = new Set<EdgeId>();

      if (selectedEdgeIdSet.has(row.edge.id)) {
        selection.selectedEdgeIds.forEach((edgeId) => {
          if (seen.has(edgeId)) {
            return;
          }
          const lookup = edgeLookup.get(edgeId);
          if (!lookup || lookup.edge.parentId !== parentId) {
            return;
          }
          edgesToMove.push(lookup.edge);
          seen.add(edgeId);
        });
      }

      if (edgesToMove.length === 0) {
        edgesToMove.push(row.edge);
      }

      edgesToMove.sort((a, b) => (edgeOrder.get(a.id) ?? 0) - (edgeOrder.get(b.id) ?? 0));

      const edgeIds = edgesToMove.map((edge) => edge.id);
      const blockedParentIds = buildBlockedParentIds(edgesToMove);
      setDragContext({edgeIds, edges: edgesToMove, blockedParentIds});
      setDropState(null);

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', row.edge.id);
        const preview = dragPreviewRef.current;
        if (preview) {
          showDragPreview(edgeIds.length);
          event.dataTransfer.setDragImage(preview, preview.offsetWidth / 2, preview.offsetHeight / 2);
        }
      } else {
        showDragPreview(edgeIds.length);
      }
    },
    [
      buildBlockedParentIds,
      edgeLookup,
      edgeOrder,
      selectedEdgeIdSet,
      selection.selectedEdgeIds,
      setDragContext,
      showDragPreview
    ]
  );

  const handleDragEnd = useCallback(() => {
    clearDragArtifacts();
  }, [clearDragArtifacts]);

  const handleTreeDragLeave = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!dragContext) {
        return;
      }
      const related = event.relatedTarget as Node | null;
      if (!related || !event.currentTarget.contains(related)) {
        setDropState(null);
      }
    },
    [dragContext]
  );

  const renderRowContent = useCallback(
    ({row, renderNode}: RenderRowContext) => {
      const renderEditor = () => (
        <div style={{flex: 1, display: 'flex'}}>{renderNode()}</div>
      );

      if (row.isRoot || !row.edge) {
        return (
          <div style={{display: 'flex', flex: 1}}>
            <div
              style={{flex: 1, display: 'flex', height: '100%'}}
              onDragOver={(event) => handleDropZoneDragOver(event, {kind: 'child', nodeId: row.node.id})}
              onDrop={(event) => handleDropZoneDrop(event, {kind: 'child', nodeId: row.node.id})}
            >
              {renderEditor()}
            </div>
          </div>
        );
      }

      const currentEdge = row.edge;
      const leadingZones = row.ancestorEdges.map((edge) => (
        <div
          key={`ancestor:${edge.id}`}
          style={{
            width: `${INDENT_WIDTH}px`,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            height: '100%',
            paddingTop: 0,
            boxSizing: 'border-box'
          }}
          onDragOver={(event) => handleDropZoneDragOver(event, {kind: 'sibling', edge})}
          onDrop={(event) => handleDropZoneDrop(event, {kind: 'sibling', edge})}
        />
      ));

      return (
        <div style={{display: 'flex', flex: 1}}>
          <div style={{display: 'flex'}}>
            {leadingZones}
            <div
              style={{
                width: `${INDENT_WIDTH}px`,
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                height: '100%',
                paddingTop: 0,
                boxSizing: 'border-box'
              }}
              onDragOver={(event) => handleDropZoneDragOver(event, {kind: 'sibling', edge: currentEdge})}
              onDrop={(event) => handleDropZoneDrop(event, {kind: 'sibling', edge: currentEdge})}
            >
              <button
                type="button"
                draggable
                onDragStart={(event) => handleDragStart(row, event)}
                onDragEnd={handleDragEnd}
                aria-label="Drag node"
                data-role="drag-handle"
                style={{
                  width: `${BULLET_SIZE}px`,
                  height: `${BULLET_SIZE}px`,
                  borderRadius: `${BULLET_SIZE / 2}px`,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'grab',
                  fontSize: `${BULLET_SIZE}px`,
                  lineHeight: 1,
                  padding: 0,
                  color: '#333'
                }}
              >
                •
              </button>
            </div>
          </div>
          <div
            style={{flex: 1, display: 'flex', paddingTop: 0, height: '100%'}}
            onDragOver={(event) => handleDropZoneDragOver(event, {kind: 'child', nodeId: row.node.id})}
            onDrop={(event) => handleDropZoneDrop(event, {kind: 'child', nodeId: row.node.id})}
          >
            {renderEditor()}
          </div>
        </div>
      );
    },
    [handleDragEnd, handleDragStart, handleDropZoneDragOver, handleDropZoneDrop]
  );

  const applyIndentOutdent = useCallback(
    (
      direction: 'indent' | 'outdent',
      options?: {caretPosition?: number | null; targetEdgeId?: EdgeId | null}
    ) => {
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

      const preferredEdge = options?.targetEdgeId && edgeOrder.has(options.targetEdgeId)
        ? options.targetEdgeId
        : filtered[filtered.length - 1];
      const preferredPosition = options?.caretPosition ?? null;
      const singleTarget = filtered.length === 1;

      issueFocusRequest(
        preferredEdge,
        preferredPosition !== null && preferredPosition !== undefined && singleTarget
          ? preferredPosition
          : -1
      );
      handleSelectionChange(selectionManager.getSelectionSnapshot());
      return true;
    },
    [
      activeEdgeId,
      bus,
      edgeOrder,
      handleSelectionChange,
      issueFocusRequest,
      selection.selectedEdgeIds,
      selectionManager
    ]
  );

  const handleBackspaceAtStart = useCallback(
    (edge: EdgeRecord) => {
      const {edges, nodes} = initializeCollections(doc);
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

      const previousNode = nodes.get(previousEdge.childId);
      const currentNode = nodes.get(edge.childId);
      const previousPlain = previousNode ? htmlToPlainText(previousNode.html) : '';
      const currentPlain = currentNode ? htmlToPlainText(currentNode.html) : '';
      const needsSeparator =
        previousPlain.length > 0 &&
        currentPlain.length > 0 &&
        !/\s$/.test(previousPlain) &&
        !/^\s/.test(currentPlain);
      const caretPosition = previousPlain.length + (needsSeparator ? 1 : 0);

      const time = timestamp();
      bus.execute({kind: 'merge-node-into-previous', edgeId: edge.id, timestamp: time});
      const snapshot = selectionManager.selectSingle(rootId, previousEdge.id);
      handleSelectionChange(snapshot);
      issueFocusRequest(previousEdge.id, caretPosition);
      return true;
    },
    [bus, doc, handleSelectionChange, issueFocusRequest, rootId, selectionManager]
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

  const handleFocusDirectiveComplete = useCallback((requestId: number) => {
    setFocusRequest((current) => (current && current.requestId === requestId ? null : current));
  }, []);

  const handleNodeCreated = useCallback(
    ({edgeId}: {edgeId: EdgeId}) => {
      const snapshot = selectionManager.selectSingle(rootId, edgeId);
      handleSelectionChange(snapshot);
      issueFocusRequest(edgeId, 0);
      setActiveEdgeId(edgeId);
    },
    [handleSelectionChange, issueFocusRequest, rootId, selectionManager]
  );

  const focusEdgeIdForScroll = useMemo(() => {
    if (focusRequest?.edgeId) {
      return focusRequest.edgeId;
    }
    if (selection.focusEdgeId) {
      return selection.focusEdgeId;
    }
    if (selection.anchorEdgeId) {
      return selection.anchorEdgeId;
    }
    return activeEdgeId;
  }, [activeEdgeId, focusRequest, selection.anchorEdgeId, selection.focusEdgeId]);

  return (
    <div
      className={className}
      tabIndex={0}
      onKeyDown={handleContainerKeyDown}
      role="presentation"
      style={{outline: 'none', overflow: 'auto'}}
      ref={containerRef}
      onDragLeave={handleTreeDragLeave}
      onDrop={(event) => {
        if (dragContext) {
          event.preventDefault();
          clearDragArtifacts();
        }
      }}
    >
      <VirtualizedOutline
        snapshot={rowsSnapshot}
        scrollParentRef={containerRef}
        rootSelected={rootSelected}
        selectedEdgeIds={selectedEdgeIdSet}
        focusEdgeId={focusEdgeIdForScroll}
        treeRef={treeRef}
        draggingEdgeIds={draggingEdgeIdSet}
        dropIndicator={dropState?.indicator ?? null}
        renderRow={renderRowContent}
        renderNode={(row) => {
          const focusDirective = row.edge && focusRequest?.edgeId === row.edge.id
            ? focusRequest
            : null;

          return (
            <NodeEditor
              nodeId={row.node.id}
              edge={row.edge}
              onNodeCreated={handleNodeCreated}
              onBackspaceAtStart={row.edge ? handleBackspaceAtStart : undefined}
              onTabCommand={(edge, direction, caretPosition) => {
                if (!edge) {
                  return false;
                }
                setActiveEdgeId(edge.id);
                return applyIndentOutdent(direction, {caretPosition, targetEdgeId: edge.id});
              }}
              focusDirective={focusDirective}
              onFocusDirectiveComplete={handleFocusDirectiveComplete}
              onFocusEdge={(edgeId) => {
                setActiveEdgeId(edgeId);
                if (edgeId) {
                  setRootSelected(false);
                }
              }}
            />
          );
        }}
        onRowMouseDown={handleRowMouseDown}
        onRowMouseEnter={handleRowMouseEnter}
        onRowMouseUp={handleRowMouseUp}
      />
    </div>
  );
};
