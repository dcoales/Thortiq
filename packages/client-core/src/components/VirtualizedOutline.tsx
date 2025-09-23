import {memo, useEffect, useMemo} from 'react';
import type {MouseEvent, ReactNode, RefObject} from 'react';
import {useVirtualizer} from '@tanstack/react-virtual';

import type {OutlineRowsSnapshot, VirtualizedNodeRow} from '../virtualization/outlineRows';
import type {EdgeId} from '../types';

export interface VirtualizedOutlineProps {
  readonly snapshot: OutlineRowsSnapshot;
  readonly scrollParentRef: RefObject<HTMLDivElement>;
  readonly renderNode?: (row: VirtualizedNodeRow) => ReactNode;
  readonly onRowMouseDown?: (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly onRowMouseEnter?: (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly onRowMouseUp?: (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly rootSelected?: boolean;
  readonly selectedEdgeIds?: ReadonlySet<EdgeId>;
  readonly focusEdgeId?: EdgeId | null;
  readonly overscan?: number;
}

const DEFAULT_ROW_HEIGHT = 36;

export const VirtualizedOutline = memo<VirtualizedOutlineProps>(
  ({
    snapshot,
    scrollParentRef,
    renderNode,
    onRowMouseDown,
    onRowMouseEnter,
    onRowMouseUp,
    rootSelected = false,
    selectedEdgeIds,
    focusEdgeId,
    overscan = 12
  }) => {
    const {rows, edgeToIndex, hasNonRootRows} = snapshot;
    const skipRootRow = hasNonRootRows && rows.length > 1 && rows[0]?.isRoot;
    const virtualCount = skipRootRow ? rows.length - 1 : rows.length;
    const baseOffset = skipRootRow ? 1 : 0;

    const virtualizer = useVirtualizer({
      count: virtualCount,
      overscan,
      estimateSize: () => DEFAULT_ROW_HEIGHT,
      getScrollElement: () => scrollParentRef.current
    });

    useEffect(() => {
      if (!focusEdgeId) {
        return;
      }
      const index = edgeToIndex.get(focusEdgeId);
      if (index === undefined) {
        return;
      }
      const virtualIndex = index - baseOffset;
      if (virtualIndex < 0 || virtualIndex >= virtualCount) {
        return;
      }
      virtualizer.scrollToIndex(virtualIndex, {align: 'auto'});
    }, [baseOffset, edgeToIndex, focusEdgeId, virtualCount, virtualizer]);

    const virtualItems = virtualizer.getVirtualItems();
    const totalSize = virtualizer.getTotalSize();

    const rowsToRender = useMemo(() => {
      if (!skipRootRow) {
        return rows;
      }
      return rows.slice(baseOffset);
    }, [rows, skipRootRow, baseOffset]);

    const resolveSelection = (row: VirtualizedNodeRow): boolean => {
      if (row.isRoot) {
        return rootSelected;
      }
      if (!row.edge) {
        return false;
      }
      return selectedEdgeIds?.has(row.edge.id) ?? false;
    };

    if (virtualCount === 0) {
      const singleRow = rows[0];
      return (
        <div role="tree">
          {singleRow ? (
            <Row
              row={singleRow}
              renderNode={renderNode}
              onMouseDown={onRowMouseDown}
              onMouseEnter={onRowMouseEnter}
              onMouseUp={onRowMouseUp}
              isSelected={rootSelected}
            />
          ) : null}
        </div>
      );
    }

    if (virtualItems.length === 0) {
      // Fallback for environments without layout metrics (e.g. JSDOM tests).
      return (
        <div role="tree">
          {rowsToRender.map((row) => {
            const key = row.edge ? row.edge.id : row.node.id;
            return (
              <Row
                key={key}
                row={row}
                renderNode={renderNode}
                onMouseDown={onRowMouseDown}
                onMouseEnter={onRowMouseEnter}
                onMouseUp={onRowMouseUp}
                isSelected={resolveSelection(row)}
              />
            );
          })}
        </div>
      );
    }

    return (
      <div role="tree" style={{position: 'relative'}}>
        <div style={{height: totalSize, position: 'relative'}}>
          {virtualItems.map((item) => {
            const row = rowsToRender[item.index];
            if (!row) {
              return null;
            }

            const key = row.edge ? row.edge.id : row.node.id;
            const isSelected = resolveSelection(row);

            return (
              <div
                key={key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`
                }}
              >
                <Row
                  row={row}
                  renderNode={renderNode}
                  onMouseDown={onRowMouseDown}
                  onMouseEnter={onRowMouseEnter}
                  onMouseUp={onRowMouseUp}
                  isSelected={isSelected}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);

VirtualizedOutline.displayName = 'VirtualizedOutline';

interface RowProps {
  readonly row: VirtualizedNodeRow;
  readonly renderNode?: (row: VirtualizedNodeRow) => ReactNode;
  readonly onMouseDown?: (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly onMouseEnter?: (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly onMouseUp?: (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly isSelected: boolean;
}

const Row = ({row, renderNode, onMouseDown, onMouseEnter, onMouseUp, isSelected}: RowProps) => {
  const handleMouseDown = onMouseDown ? (event: MouseEvent<HTMLDivElement>) => onMouseDown(row, event) : undefined;
  const handleMouseEnter = onMouseEnter ? (event: MouseEvent<HTMLDivElement>) => onMouseEnter(row, event) : undefined;
  const handleMouseUp = onMouseUp ? (event: MouseEvent<HTMLDivElement>) => onMouseUp(row, event) : undefined;
  const depth = Math.max(0, row.depth);
  const ariaLevel = Math.max(1, row.depth + 1);

  return (
    <div
      data-edge-id={row.edge?.id}
      role="treeitem"
      aria-level={ariaLevel}
      aria-selected={isSelected}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseUp={handleMouseUp}
      style={{
        paddingLeft: `${depth * 16}px`,
        display: 'flex',
        alignItems: 'center',
        backgroundColor: isSelected ? 'rgba(173, 216, 230, 0.35)' : 'transparent'
      }}
    >
      <span style={{marginRight: '0.75rem'}}>•</span>
      {renderNode ? (
        renderNode(row)
      ) : (
        <span dangerouslySetInnerHTML={{__html: row.node.html}} />
      )}
    </div>
  );
};
