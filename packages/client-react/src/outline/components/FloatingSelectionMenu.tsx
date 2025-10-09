/**
 * Renders a floating menu anchored to the current ProseMirror selection. The menu lives in a
 * portal outside the row DOM so TanStack Virtual measurements stay untouched (AGENTS §23), and
 * all positioning updates react to editor selection changes without mutating outline content.
 */
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";

import type { CollaborativeEditor } from "@thortiq/editor-prosemirror";
import type { EditorView } from "prosemirror-view";

const DEFAULT_OFFSET_Y = -8;

interface SelectionAnchorState {
  readonly editor: CollaborativeEditor;
  readonly rect: DOMRect;
  readonly isCollapsed: boolean;
}

/** Props accepted by {@link FloatingSelectionMenu}. */
export interface FloatingSelectionMenuProps {
  /**
   * Active collaborative editor instance. When null or unfocused the menu remains hidden.
   */
  readonly editor: CollaborativeEditor | null;
  /**
   * Optional portal container; defaults to the document body of the editor's owner document.
   */
  readonly portalContainer?: HTMLElement | null;
  /**
   * Additional offset applied after anchoring to the selection rectangle.
   */
  readonly offset?: {
    readonly x?: number;
    readonly y?: number;
  };
  /**
   * Optional fixed class name applied to the floating host element.
   */
  readonly className?: string;
  /**
   * Optional style overrides merged with computed positioning.
   */
  readonly style?: CSSProperties;
  /**
   * Menu content rendered inside the floating host. If a function is provided it receives the
   * current selection context; otherwise the node is rendered verbatim.
   */
  readonly children:
    | ReactNode
    | ((context: FloatingSelectionMenuRenderContext) => ReactNode);
}

export interface FloatingSelectionMenuRenderContext {
  readonly editor: CollaborativeEditor;
  readonly selectionRect: DOMRectReadOnly;
  readonly isSelectionCollapsed: boolean;
}

const areRectsEqual = (a: DOMRect, b: DOMRect): boolean => {
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
};

const createRect = (view: EditorView, left: number, top: number, width: number, height: number): DOMRect => {
  const domRectCtor =
    view.dom.ownerDocument?.defaultView?.DOMRect ??
    (typeof DOMRect === "function" ? DOMRect : null);
  if (domRectCtor) {
    return new domRectCtor(left, top, width, height);
  }
  const right = left + width;
  const bottom = top + height;
  return {
    x: left,
    y: top,
    left,
    top,
    right,
    bottom,
    width,
    height,
    toJSON() {
      return { x: left, y: top, left, top, right, bottom, width, height };
    }
  } as DOMRect;
};

const computeSelectionRect = (view: EditorView): DOMRect | null => {
  const { selection } = view.state;
  if (selection.empty) {
    return null;
  }
  try {
    const start = view.coordsAtPos(selection.from);
    const end = view.coordsAtPos(selection.to);
    const left = Math.min(start.left, end.left);
    const right = Math.max(start.right, end.right);
    const top = Math.min(start.top, end.top);
    const bottom = Math.max(start.bottom, end.bottom);
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    return createRect(view, left, top, width, height);
  } catch (error) {
    // coordsAtPos can throw while the view is updating; ignore and hide until the next tick.
    return null;
  }
};

/**
 * Floating selection menu positioned near the active text selection of a collaborative editor.
 * The menu attaches to a portal so virtualization can recycle rows without carrying the menu DOM.
 */
export const FloatingSelectionMenu = ({
  editor,
  portalContainer,
  offset,
  className,
  style,
  children
}: FloatingSelectionMenuProps): JSX.Element | null => {
  const [anchorState, setAnchorState] = useState<SelectionAnchorState | null>(null);
  const rafRef = useRef<number | null>(null);

  const clearScheduledFrame = useCallback(() => {
    if (rafRef.current !== null) {
      const win = typeof window !== "undefined" ? window : undefined;
      if (win) {
        win.cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
    }
  }, []);

  const scheduleReposition = useCallback(() => {
    clearScheduledFrame();
    const win = typeof window !== "undefined" ? window : undefined;
    if (!win) {
      return;
    }
    rafRef.current = win.requestAnimationFrame(() => {
      rafRef.current = null;
      if (!editor) {
        setAnchorState((current) => (current ? null : current));
        return;
      }
      const { view } = editor;
      if (!view || !view.hasFocus()) {
        setAnchorState((current) => (current ? null : current));
        return;
      }
      const rect = computeSelectionRect(view);
      if (!rect) {
        setAnchorState((current) => (current ? null : current));
        return;
      }
      const isCollapsed = view.state.selection.empty;
      setAnchorState((current) => {
        if (
          current &&
          current.editor === editor &&
          areRectsEqual(current.rect, rect) &&
          current.isCollapsed === isCollapsed
        ) {
          return current;
        }
        return { editor, rect, isCollapsed };
      });
    });
  }, [clearScheduledFrame, editor]);

  useLayoutEffect(() => {
    scheduleReposition();
    return () => {
      clearScheduledFrame();
      setAnchorState(null);
    };
  }, [scheduleReposition, clearScheduledFrame, editor]);

  useEffect(() => {
    if (!editor) {
      setAnchorState(null);
      return;
    }
    const { view } = editor;
    const doc = view.dom.ownerDocument;
    const win = doc?.defaultView;
    if (!doc || !win) {
      return;
    }
    const handleSelectionChange = () => scheduleReposition();
    const handleWindowScroll = () => scheduleReposition();
    const handleWindowResize = () => scheduleReposition();
    const handleBlur = () => {
      setAnchorState((current) => (current ? null : current));
    };

    doc.addEventListener("selectionchange", handleSelectionChange);
    doc.addEventListener("pointerup", handleSelectionChange);
    doc.addEventListener("keyup", handleSelectionChange);
    view.dom.addEventListener("blur", handleBlur);
    win.addEventListener("scroll", handleWindowScroll, true);
    win.addEventListener("resize", handleWindowResize);

    return () => {
      doc.removeEventListener("selectionchange", handleSelectionChange);
      doc.removeEventListener("pointerup", handleSelectionChange);
      doc.removeEventListener("keyup", handleSelectionChange);
      view.dom.removeEventListener("blur", handleBlur);
      win.removeEventListener("scroll", handleWindowScroll, true);
      win.removeEventListener("resize", handleWindowResize);
    };
  }, [editor, scheduleReposition]);

  const resolvedAnchor = anchorState?.rect ?? null;
  const effectivePortal = useMemo(() => {
    if (!resolvedAnchor) {
      return null;
    }
    if (portalContainer) {
      return portalContainer;
    }
    const doc = editor?.view.dom.ownerDocument;
    return doc?.body ?? null;
  }, [editor, portalContainer, resolvedAnchor]);

  if (!resolvedAnchor || !anchorState || !effectivePortal) {
    return null;
  }

  const deltaX = offset?.x ?? 0;
  const deltaY = offset?.y ?? DEFAULT_OFFSET_Y;
  const computedStyle: CSSProperties = {
    position: "fixed",
    top: resolvedAnchor.top + deltaY,
    left: resolvedAnchor.left + resolvedAnchor.width / 2 + deltaX,
    transform: "translate(-50%, -100%)",
    zIndex: 20_000,
    pointerEvents: "auto",
    ...style
  };

  const content =
    typeof children === "function"
      ? children({
          editor: anchorState.editor,
          selectionRect: resolvedAnchor,
          isSelectionCollapsed: anchorState.isCollapsed
        })
      : children;

  if (!content) {
    return null;
  }

  return createPortal(
    <div
      className={className}
      style={computedStyle}
      data-floating-selection-menu="true"
      role="presentation"
    >
      {content}
    </div>,
    effectivePortal
  );
};
