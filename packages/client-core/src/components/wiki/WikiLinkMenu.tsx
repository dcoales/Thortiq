/**
 * WikiLinkMenu
 *
 * Presentational popup for wiki link candidates. It renders a simple list with
 * keyboard/mouse selection. Parent controls positioning and visibility.
 */
import type {MouseEvent} from 'react';
import React from 'react';
import type {NodeId} from '../../types';
import type {WikiCandidate} from '../../wiki/search';

export interface WikiLinkMenuProps {
  readonly open: boolean;
  readonly candidates: readonly WikiCandidate[];
  readonly activeIndex: number;
  readonly onSelect: (nodeId: NodeId) => void;
  readonly onHoverIndex?: (index: number) => void;
  readonly style?: React.CSSProperties;
}

export const WikiLinkMenu = ({open, candidates, activeIndex, onSelect, onHoverIndex, style}: WikiLinkMenuProps) => {
  if (!open) return null;
  return (
    <div
      role="listbox"
      style={{
        position: style?.position ?? 'absolute',
        zIndex: 10,
        background: 'white',
        border: '1px solid #e2e2e2',
        borderRadius: 4,
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        minWidth: 280,
        maxHeight: 240,
        overflowY: 'auto',
        ...style
      }}
    >
      {candidates.length === 0 ? (
        <div style={{padding: '8px 10px', color: '#888'}}>No matches</div>
      ) : (
        candidates.map((c, idx) => (
          <div
            key={c.nodeId + ':' + idx}
            role="option"
            aria-selected={activeIndex === idx}
            onMouseEnter={() => onHoverIndex?.(idx)}
            onMouseDown={(e: MouseEvent) => {
              // Prevent textarea blur before we handle selection
              e.preventDefault();
              onSelect(c.nodeId);
            }}
            style={{
              padding: '6px 10px',
              cursor: 'pointer',
              background: activeIndex === idx ? '#f0f6ff' : 'transparent'
            }}
            title={c.breadcrumb}
          >
            <div style={{fontSize: 13, color: '#111'}}>{c.label}</div>
            <div style={{fontSize: 11, color: '#666', marginTop: 2}}>{c.breadcrumb}</div>
          </div>
        ))
      )}
    </div>
  );
};
