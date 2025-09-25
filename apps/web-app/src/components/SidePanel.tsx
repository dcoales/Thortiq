import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {FC, MouseEvent as ReactMouseEvent} from 'react';

/**
 * SidePanel
 * Collapsible, resizable left panel that never overlays the main content.
 * Shows a vertical strip with icons when collapsed and a full list when open.
 * The resize handle (right edge) updates the stored width used when reopened.
 */
export interface SidePanelProps {
  isOpen: boolean;
  width: number; // width used when open
  onToggle: () => void;
  onResize: (width: number) => void;
  status: string; // sync status label
  userDisplayName: string | null;
  syncError: string | null;
}

// Allow a smaller minimum width (~2/3 of previous 200px)
const MIN_WIDTH = 132;
const MAX_WIDTH = 480;
// Collapsed width equals 2 * horizontal padding (12px) + icon width (24px)
// This centers the icon with equal left/right margins when minimized.
const COLLAPSED_WIDTH = 48; // 12 + 24 + 12

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const GearIcon: FC<{size?: number}> = ({size = 20}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm8 3.5c0-.5-.04-.98-.12-1.45l2.1-1.62-2-3.46-2.53 1a8.06 8.06 0 0 0-2.51-1.45l-.38-2.68H9.44l-.38 2.68c-.9.3-1.75.74-2.51 1.45l-2.53-1-2 3.46 2.1 1.62c-.08.47-.12.95-.12 1.45 0 .5.04.98.12 1.45l-2.1 1.62 2 3.46 2.53-1c.76.7 1.61 1.15 2.51 1.45l.38 2.68h4.62l.38-2.68c.9-.3 1.75-.74 2.51-1.45l2.53 1 2-3.46-2.1-1.62c.08-.47.12-.95.12-1.45Z"
      stroke="#4b5563"
      strokeWidth="1.2"
      fill="none"
    />
  </svg>
);

const ChevronIcon: FC<{direction: 'left' | 'right'; size?: number}> = ({direction, size = 18}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    {direction === 'left' ? (
      <path d="M14.5 6 8.5 12l6 6" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    ) : (
      <path d="M9.5 6 15.5 12l-6 6" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    )}
  </svg>
);

export const SidePanel: FC<SidePanelProps> = ({
  isOpen,
  width,
  onToggle,
  onResize,
  status,
  userDisplayName,
  syncError
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // Use memo to avoid recomputing on every render
  const computedWidth = useMemo(() => (isOpen ? clamp(width, MIN_WIDTH, MAX_WIDTH) : COLLAPSED_WIDTH), [isOpen, width]);

  const onMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (ev: MouseEvent) => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = clamp(ev.clientX - rect.left, MIN_WIDTH, MAX_WIDTH);
      onResize(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, {once: true});
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, onResize]);

  const statusColor = status === 'connected' ? '#16a34a' : '#9ca3af';
  const statusDetails: string[] = [`Status: ${status}`];
  if (userDisplayName) statusDetails.push(`Signed in as ${userDisplayName}`);
  if (syncError) statusDetails.push(`Error: ${syncError}`);
  const statusTitle = statusDetails.join(' • ');
  const statusAria = statusDetails.join('. ');

  return (
    <div
      ref={panelRef}
      style={{
        width: computedWidth,
        borderRight: '1px solid #e5e7eb',
        background: '#f9fafb',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh'
      }}
    >
      {/* Toggle */}
      <button
        onClick={onToggle}
        title={isOpen ? 'Collapse panel' : 'Expand panel'}
        aria-label={isOpen ? 'Collapse panel' : 'Expand panel'}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          width: 28,
          height: 28,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid #d1d5db',
          borderRadius: 4,
          background: '#ffffff',
          cursor: 'pointer'
        }}
      >
        <ChevronIcon direction={isOpen ? 'left' : 'right'} />
      </button>

      {/* Options list */}
      <div style={{paddingTop: 48, paddingBottom: 56}}>
        <button
          type="button"
          title="Settings"
          aria-label="Settings"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 12px',
            justifyContent: isOpen ? 'flex-start' : 'center',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: '#111827'
          }}
          onClick={() => { /* no-op for now */ }}
        >
          <div style={{width: 24, display: 'flex', justifyContent: 'center'}}>
            <GearIcon />
          </div>
          {isOpen && <span style={{fontSize: 14}}>Settings</span>}
        </button>
      </div>

      {/* Connection indicator at the bottom-left; always visible even when collapsed */}
      <div
        role="status"
        title={statusTitle}
        aria-label={statusAria}
        style={{
          position: 'absolute',
          left: 10,
          bottom: 14, // extra margin so it doesn't sit flush
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          maxWidth: isOpen ? '100%' : 24
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            backgroundColor: statusColor,
            border: '1px solid #d1d5db',
            flex: '0 0 auto'
          }}
        />
        {isOpen && (
          <div style={{fontSize: 12, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
            {userDisplayName ? `${userDisplayName} • ${status}` : status}
          </div>
        )}
      </div>

      {/* Resize handle (right edge) */}
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onMouseDown}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 4,
          cursor: 'col-resize',
          background: dragging ? 'rgba(59,130,246,0.2)' : 'transparent'
        }}
      />
    </div>
  );
};

export default SidePanel;
