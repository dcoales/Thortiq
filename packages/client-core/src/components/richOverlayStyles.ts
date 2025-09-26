/**
 * richOverlayStyles.ts
 *
 * Responsibility: Provide consistent inline style definitions for the outline
 * rich editor layers so tests can assert flicker behaviour without touching the
 * DOM directly.
 */
import type {CSSProperties} from 'react';

export const buildRichOverlayStyles = (
  lineHeightPx: number,
  overlayReady: boolean
): {underlay: CSSProperties; overlay: CSSProperties} => {
  const lineHeight = `${lineHeightPx}px`;
  const underlay: CSSProperties = {
    flex: 1,
    display: 'flex',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight,
    minHeight: lineHeight,
    visibility: overlayReady ? 'hidden' : 'visible',
    pointerEvents: overlayReady ? 'none' : 'auto'
  };
  const overlay: CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    lineHeight,
    minHeight: lineHeight,
    pointerEvents: overlayReady ? 'auto' : 'none',
    visibility: overlayReady ? 'visible' : 'hidden'
  };
  return {underlay, overlay};
};
