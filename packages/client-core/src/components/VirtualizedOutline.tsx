import {memo} from 'react';
import type {ReactNode} from 'react';

import type {VirtualizedNodeRow} from '../hooks/useVirtualizedNodes';

export interface VirtualizedOutlineProps {
  readonly rows: readonly VirtualizedNodeRow[];
  readonly renderNode?: (row: VirtualizedNodeRow) => ReactNode;
}

export const VirtualizedOutline = memo<VirtualizedOutlineProps>(({rows, renderNode}) => {
  return (
    <div role="tree">
      {rows.map((row) => (
        <div
          key={row.node.id}
          role="treeitem"
          aria-level={row.depth + 1}
          style={{
            paddingLeft: `${row.depth * 16}px`,
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <span style={{marginRight: '0.75rem'}}>•</span>
          {renderNode ? (
            renderNode(row)
          ) : (
            <span dangerouslySetInnerHTML={{__html: row.node.html}} />
          )}
        </div>
      ))}
    </div>
  );
});

VirtualizedOutline.displayName = 'VirtualizedOutline';
