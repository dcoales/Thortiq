/**
 * WikiLinkEditDialog
 *
 * Presents an inline dialog to edit the display text of a wikilink while
 * keeping the target node fixed. Parent controls positioning and visibility.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import type {NodeId} from '../../types';

export interface WikiLinkEditDialogProps {
  readonly open: boolean;
  readonly targetNodeId: NodeId;
  readonly initialDisplay: string;
  readonly style?: React.CSSProperties; // absolute/fixed position supplied by parent
  readonly onCancel: () => void;
  readonly onSave: (display: string) => void;
}

export const WikiLinkEditDialog = ({open, targetNodeId, initialDisplay, style, onCancel, onSave}: WikiLinkEditDialogProps) => {
  const [display, setDisplay] = useState(initialDisplay);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setDisplay(initialDisplay);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [initialDisplay, open]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    onSave(display.trim());
  }, [display, onSave]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label="Edit wikilink"
      style={{
        position: style?.position ?? 'fixed',
        zIndex: 20,
        background: '#fff',
        border: '1px solid #e2e2e2',
        borderRadius: 6,
        boxShadow: '0 8px 16px rgba(0,0,0,0.12)',
        padding: '10px',
        minWidth: 260,
        ...style
      }}
    >
      <form onSubmit={handleSubmit}>
        <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
          <label style={{fontSize: 12, color: '#666'}}>Display text</label>
          <input
            ref={inputRef}
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
            style={{padding: '6px 8px', border: '1px solid #dcdcdc', borderRadius: 4}}
          />
          <label style={{fontSize: 12, color: '#666'}}>Target node</label>
          <input value={targetNodeId} readOnly style={{padding: '6px 8px', border: '1px solid #f0f0f0', borderRadius: 4, background: '#fafafa'}} />
          <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6}}>
            <button type="button" onClick={onCancel} style={{padding: '6px 10px'}}>Cancel</button>
            <button type="submit" style={{padding: '6px 10px', color: '#fff', background: '#2563eb', border: 'none', borderRadius: 4}}>Save</button>
          </div>
        </div>
      </form>
    </div>
  );
};

