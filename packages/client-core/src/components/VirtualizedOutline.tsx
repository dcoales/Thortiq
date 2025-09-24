import {memo, useEffect, useMemo} from 'react';
import type {MouseEvent, ReactNode, RefObject} from 'react';
import {useVirtualizer} from '@tanstack/react-virtual';

import type {OutlineRowsSnapshot, VirtualizedNodeRow} from '../virtualization/outlineRows';
import type {EdgeId} from '../types';

export interface VirtualizedOutlineProps {
  readonly snapshot: OutlineRowsSnapshot;
  readonly scrollParentRef: RefObject<HTMLDivElement>;
  readonly renderNode?: (row: VirtualizedNodeRow) => ReactNode;
  readonly renderRow?: (options: RenderRowContext) => ReactNode;
  readonly onRowMouseDown?: (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly onRowMouseEnter?: (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly onRowMouseUp?: (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly rootSelected?: boolean;
  readonly selectedEdgeIds?: ReadonlySet<EdgeId>;
  readonly focusEdgeId?: EdgeId | null;
  readonly draggingEdgeIds?: ReadonlySet<EdgeId>;
  readonly dropIndicator?: DropIndicator | null;
  readonly treeRef?: RefObject<HTMLDivElement>;
  readonly overscan?: number;
}

export interface RenderRowContext {
  readonly row: VirtualizedNodeRow;
  readonly isSelected: boolean;
  readonly renderNode: () => ReactNode;
}

export interface DropIndicator {
  readonly top: number;
  readonly left: number;
  readonly width: number;
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
    overscan = 12,
    renderRow,
    draggingEdgeIds,
    dropIndicator,
    treeRef
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
        <div role="tree" ref={treeRef} style={{position: 'relative'}}>
          {singleRow ? (
            <Row
              row={singleRow}
              renderNode={renderNode}
              renderRow={renderRow}
              onMouseDown={onRowMouseDown}
              onMouseEnter={onRowMouseEnter}
              onMouseUp={onRowMouseUp}
              isSelected={rootSelected}
              draggingEdgeIds={draggingEdgeIds}
            />
          ) : null}
          {dropIndicator ? (
            <div
              style={{
                position: 'absolute',
                pointerEvents: 'none',
                top: `${dropIndicator.top}px`,
                left: `${dropIndicator.left}px`,
                width: `${dropIndicator.width}px`,
                height: '2px',
                backgroundColor: 'rgba(128, 128, 128, 0.85)',
                borderRadius: '1px',
                zIndex: 1
              }}
            />
          ) : null}
        </div>
      );
    }

    if (virtualItems.length === 0) {
      // Fallback for environments without layout metrics (e.g. JSDOM tests).
      return (
        <div role="tree" ref={treeRef} style={{position: 'relative'}}>
          {rowsToRender.map((row) => {
            const key = row.edge ? row.edge.id : row.node.id;
            return (
              <Row
                key={key}
                row={row}
                renderNode={renderNode}
                renderRow={renderRow}
                onMouseDown={onRowMouseDown}
                onMouseEnter={onRowMouseEnter}
                onMouseUp={onRowMouseUp}
                isSelected={resolveSelection(row)}
                draggingEdgeIds={draggingEdgeIds}
              />
            );
          })}
          {dropIndicator ? (
            <div
              style={{
                position: 'absolute',
                pointerEvents: 'none',
                top: `${dropIndicator.top}px`,
                left: `${dropIndicator.left}px`,
                width: `${dropIndicator.width}px`,
                height: '2px',
                backgroundColor: 'rgba(128, 128, 128, 0.85)',
                borderRadius: '1px',
                zIndex: 1
              }}
            />
          ) : null}
        </div>
      );
    }

    return (
      <div role="tree" ref={treeRef} style={{position: 'relative'}}>
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
                  renderRow={renderRow}
                  onMouseDown={onRowMouseDown}
                  onMouseEnter={onRowMouseEnter}
                  onMouseUp={onRowMouseUp}
                  isSelected={isSelected}
                  draggingEdgeIds={draggingEdgeIds}
                />
              </div>
            );
          })}
          {dropIndicator ? (
            <div
              style={{
                position: 'absolute',
                pointerEvents: 'none',
                top: `${dropIndicator.top}px`,
                left: `${dropIndicator.left}px`,
                width: `${dropIndicator.width}px`,
                height: '2px',
                backgroundColor: 'rgba(128, 128, 128, 0.85)',
                borderRadius: '1px',
                zIndex: 1
              }}
            />
          ) : null}
        </div>
      </div>
    );
  }
);

VirtualizedOutline.displayName = 'VirtualizedOutline';

interface RowProps {
  readonly row: VirtualizedNodeRow;
  readonly renderNode?: (row: VirtualizedNodeRow) => ReactNode;
  readonly renderRow?: (options: RenderRowContext) => ReactNode;
  readonly onMouseDown?: (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly onMouseEnter?: (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly onMouseUp?: (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly isSelected: boolean;
  readonly draggingEdgeIds?: ReadonlySet<EdgeId>;
}

const Row = ({
  row,
  renderNode,
  renderRow,
  onMouseDown,
  onMouseEnter,
  onMouseUp,
  isSelected,
  draggingEdgeIds
}: RowProps) => {
  const handleMouseDown = onMouseDown ? (event: MouseEvent<HTMLDivElement>) => onMouseDown(row, event) : undefined;
  const handleMouseEnter = onMouseEnter ? (event: MouseEvent<HTMLDivElement>) => onMouseEnter(row, event) : undefined;
  const handleMouseUp = onMouseUp ? (event: MouseEvent<HTMLDivElement>) => onMouseUp(row, event) : undefined;
  const ariaLevel = Math.max(1, row.depth + 1);
  const isDragging = row.edge ? draggingEdgeIds?.has(row.edge.id) ?? false : false;

  const renderNodeContent = () =>
    renderNode ? renderNode(row) : <span dangerouslySetInnerHTML={{__html: row.node.html}} />;

  const content = renderRow
    ? renderRow({row, isSelected, renderNode: renderNodeContent})
    : (
      <>
        <span style={{marginRight: '0.75rem'}}>•</span>
        {renderNodeContent()}
      </>
    );

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
        display: 'flex',
        alignItems: 'stretch',
        backgroundColor: isSelected ? 'rgba(173, 216, 230, 0.35)' : 'transparent',
        opacity: isDragging ? 0.4 : 1
      }}
    >
      {content}
    </div>
  );
};
