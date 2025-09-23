import {memo} from 'react';
import type {MouseEvent, ReactNode} from 'react';

import type {VirtualizedNodeRow} from '../hooks/useVirtualizedNodes';

export interface VirtualizedOutlineProps {
  readonly rows: readonly VirtualizedNodeRow[];
  readonly renderNode?: (row: VirtualizedNodeRow) => ReactNode;
  readonly onRowMouseDown?: (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly onRowMouseEnter?: (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly onRowMouseUp?: (row: VirtualizedNodeRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly rootSelected?: boolean;
}

export const VirtualizedOutline = memo<VirtualizedOutlineProps>(
  ({rows, renderNode, onRowMouseDown, onRowMouseEnter, onRowMouseUp, rootSelected = false}) => (
    <div role="tree">
      {rows.map((row) => (
        <Row
          key={row.node.id}
          row={row}
          renderNode={renderNode}
          onMouseDown={onRowMouseDown}
          onMouseEnter={onRowMouseEnter}
          onMouseUp={onRowMouseUp}
          isSelected={row.isRoot ? rootSelected : row.edge?.selected ?? false}
        />
      ))}
    </div>
  )
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

  return (
    <div
      data-edge-id={row.edge?.id}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={isSelected}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseUp={handleMouseUp}
      style={{
        paddingLeft: `${row.depth * 16}px`,
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
