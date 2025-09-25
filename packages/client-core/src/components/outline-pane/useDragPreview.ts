/**
 * Provides the DOM element used for drag previews while keeping creation and
 * teardown inside a React hook.  Helps OutlinePane avoid manipulating the
 * document body directly.
 */
import {useCallback, useEffect, useRef} from 'react';

export interface DragPreviewHandle {
  readonly show: (count: number) => void;
  readonly hide: () => void;
  readonly getElement: () => HTMLDivElement | null;
}

export const useDragPreview = (): DragPreviewHandle => {
  const previewRef = useRef<HTMLDivElement | null>(null);

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
    previewRef.current = preview;
    document.body.appendChild(preview);
    return () => {
      document.body.removeChild(preview);
      previewRef.current = null;
    };
  }, []);

  const show = useCallback((count: number) => {
    const preview = previewRef.current;
    if (!preview) {
      return;
    }
    preview.textContent = count.toString();
    preview.style.display = 'flex';
  }, []);

  const hide = useCallback(() => {
    const preview = previewRef.current;
    if (!preview) {
      return;
    }
    preview.style.display = 'none';
    preview.textContent = '';
  }, []);

  const getElement = useCallback(() => previewRef.current, []);

  return {show, hide, getElement};
};
