import {useCallback, useEffect, useMemo, useState} from 'react';
import type {KeyboardEvent, MouseEvent} from 'react';

import type {EdgeId, NodeId} from '../types';
import type {VirtualizedNodeRow} from '../hooks/useVirtualizedNodes';
import {useVirtualizedNodes} from '../hooks/useVirtualizedNodes';
import {VirtualizedOutline} from './VirtualizedOutline';
import {NodeEditor} from './NodeEditor';
import {SelectionManager} from '../selection/selectionManager';
import type {SelectionSnapshot} from '../selection/selectionManager';
import {useYDoc} from '../hooks/yDocContext';

interface OutlinePaneProps {
  readonly rootId: NodeId;
  readonly className?: string;
}

interface DragState {
  readonly isDragging: boolean;
  readonly anchorEdgeId: EdgeId | null;
}

export const OutlinePane = ({rootId, className}: OutlinePaneProps) => {
  const doc = useYDoc();
  const rows = useVirtualizedNodes({rootId});
  const selectionManager = useMemo(() => new SelectionManager(doc), [doc]);
  const [selection, setSelection] = useState(() => selectionManager.getSelectionSnapshot());
  const [dragState, setDragState] = useState<DragState>({isDragging: false, anchorEdgeId: null});

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
    setSelection(snapshot);
  }, []);

  const handleRowMouseDown = useCallback(
    (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => {
      if (!row.edge) {
        return;
      }

      const isTextAreaTarget = (event.target as HTMLElement | null)?.closest('textarea');
      const rowElement = event.currentTarget as HTMLDivElement;
      if (!isTextAreaTarget) {
        event.preventDefault();
      }

      let snapshot;
      if (event.shiftKey && selection.anchorEdgeId) {
        snapshot = selectionManager.selectRange(rootId, selection.anchorEdgeId, row.edge.id);
      } else if (event.metaKey || event.ctrlKey) {
        snapshot = selectionManager.toggleEdge(rootId, row.edge.id);
      } else {
        snapshot = selectionManager.selectSingle(rootId, row.edge.id);
      }

      handleSelectionChange(snapshot);
      setDragState({isDragging: true, anchorEdgeId: snapshot.anchorEdgeId ?? row.edge.id});

      if (!isTextAreaTarget) {
        requestAnimationFrame(() => {
          const textarea = rowElement.querySelector('textarea');
          if (textarea instanceof HTMLTextAreaElement) {
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
          }
        });
      }
    },
    [handleSelectionChange, rootId, selection.anchorEdgeId, selectionManager]
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

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
      }

      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 'next' : 'previous';
      const origin = selection.focusEdgeId ?? selection.anchorEdgeId ?? null;
      const snapshot = selectionManager.moveFocus(rootId, origin, direction);
      handleSelectionChange(snapshot);
    },
    [handleSelectionChange, rootId, selection.focusEdgeId, selection.anchorEdgeId, selectionManager]
  );

  return (
    <div
      className={className}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="presentation"
      style={{outline: 'none'}}
    >
      <VirtualizedOutline
        rows={rows}
        renderNode={(row) => <NodeEditor nodeId={row.node.id} edge={row.edge} />}
        onRowMouseDown={handleRowMouseDown}
        onRowMouseEnter={handleRowMouseEnter}
        onRowMouseUp={handleRowMouseUp}
      />
    </div>
  );
};
