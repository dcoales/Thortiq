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
  /**
   * When true the menu persists while auxiliary editors (e.g. color picker) are open outside of the
   * ProseMirror view. Defaults to false so the menu hides on outside interaction.
   */
  readonly interactionLockActive?: boolean;
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
  children,
  interactionLockActive
}: FloatingSelectionMenuProps): JSX.Element | null => {
  const [anchorState, setAnchorState] = useState<SelectionAnchorState | null>(null);
  const rafRef = useRef<number | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [menuRect, setMenuRect] = useState<{ width: number; height: number } | null>(null);
  // Tracks pointer/focus interactions inside the floating menu so we keep it mounted while users
  // interact with formatting controls that temporarily steal focus from the editor.
  const menuInteractionRef = useRef(false);
  const pointerInsideRef = useRef(false);
  const focusInsideRef = useRef(false);
  const blurTimeoutRef = useRef<number | null>(null);
  const interactionLockRef = useRef(false);

  const clearScheduledFrame = useCallback(() => {
    if (rafRef.current !== null) {
      const win = typeof window !== "undefined" ? window : undefined;
      if (win) {
        win.cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
    }
  }, []);

  const clearBlurTimeout = useCallback(() => {
    if (blurTimeoutRef.current === null) {
      return;
    }
    const host = hostRef.current;
    const win = host?.ownerDocument?.defaultView ?? (typeof window !== "undefined" ? window : null);
    if (win) {
      win.clearTimeout(blurTimeoutRef.current);
    }
    blurTimeoutRef.current = null;
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
      const doc = view?.dom.ownerDocument ?? null;
      const viewHasFocus =
        !!view &&
        typeof view.hasFocus === "function"
          ? view.hasFocus()
          : doc?.activeElement === view?.dom;
      if (
        !view ||
        (!viewHasFocus && !menuInteractionRef.current && !interactionLockRef.current)
      ) {
        setAnchorState((current) => (current ? null : current));
        return;
      }
      const rect = computeSelectionRect(view);
      if (!rect) {
        setAnchorState((current) => {
          if (!menuInteractionRef.current && !interactionLockRef.current) {
            return current ? null : current;
          }
          if (!current || current.editor !== editor) {
            return current;
          }
          if (current.isCollapsed) {
            return current;
          }
          return { ...current, isCollapsed: true };
        });
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

  useEffect(() => {
    const isLocked = Boolean(interactionLockActive);
    interactionLockRef.current = isLocked;
    if (isLocked) {
      if (!menuInteractionRef.current) {
        menuInteractionRef.current = true;
      }
      return;
    }

    const host = hostRef.current;
    const activeElement = host?.ownerDocument?.activeElement ?? null;
    const activeInside = activeElement instanceof Node && !!host ? host.contains(activeElement) : false;
    focusInsideRef.current = activeInside;
    if (!activeInside) {
      pointerInsideRef.current = false;
    }

    if (menuInteractionRef.current && !activeInside && !pointerInsideRef.current) {
      menuInteractionRef.current = false;
      setAnchorState(null);
      scheduleReposition();
    }
  }, [interactionLockActive, scheduleReposition]);

  const ensureInteractionDuringBlur = useCallback(
    (doc: Document | null) => {
      if (!doc) {
        return;
      }
      const win = doc.defaultView;
      if (!win) {
        return;
      }
      clearBlurTimeout();
      menuInteractionRef.current = true;
      blurTimeoutRef.current = win.setTimeout(() => {
        blurTimeoutRef.current = null;
        const host = hostRef.current;
        const activeElement = doc.activeElement;
        const stillInside =
          pointerInsideRef.current ||
          focusInsideRef.current ||
          (host && activeElement ? host.contains(activeElement) : false);
        if (!stillInside && !interactionLockRef.current) {
          menuInteractionRef.current = false;
          scheduleReposition();
        }
      }, 0);
    },
    [clearBlurTimeout, scheduleReposition]
  );

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
    const handleBlur = (event: FocusEvent) => {
      const docRef = view.dom.ownerDocument ?? null;
      ensureInteractionDuringBlur(docRef);
      const related = event.relatedTarget as Node | null;
      if (related && hostRef.current?.contains(related)) {
        focusInsideRef.current = true;
        scheduleReposition();
        return;
      }
      scheduleReposition();
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
  }, [editor, scheduleReposition, ensureInteractionDuringBlur]);

  useLayoutEffect(() => {
    const node = hostRef.current;
    if (!node) {
      setMenuRect(null);
      return;
    }

    const updateMenuRect = () => {
      const rect = node.getBoundingClientRect();
      setMenuRect((current) => {
        if (current && current.width === rect.width && current.height === rect.height) {
          return current;
        }
        return { width: rect.width, height: rect.height };
      });
    };

    updateMenuRect();

    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => updateMenuRect());
      observer.observe(node);
      return () => observer.disconnect();
    }

    const win = node.ownerDocument?.defaultView;
    if (!win) {
      return;
    }
    win.addEventListener("resize", updateMenuRect);
    return () => {
      win.removeEventListener("resize", updateMenuRect);
    };
  }, [anchorState, children]);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) {
      clearBlurTimeout();
      pointerInsideRef.current = false;
      focusInsideRef.current = false;
      menuInteractionRef.current = false;
      return;
    }

    const doc = node.ownerDocument;
    if (!doc) {
      return;
    }

    const updateInteraction = () => {
      const isActive = pointerInsideRef.current || focusInsideRef.current;
      const shouldStayActive = isActive || interactionLockRef.current;
      if (isActive) {
        clearBlurTimeout();
      }
      if (menuInteractionRef.current === shouldStayActive) {
        return;
      }
      menuInteractionRef.current = shouldStayActive;
      if (!shouldStayActive) {
        scheduleReposition();
      }
    };

    const handlePointerEnter = () => {
      pointerInsideRef.current = true;
      updateInteraction();
    };
    const handlePointerLeave = () => {
      pointerInsideRef.current = false;
      updateInteraction();
    };
    const handlePointerDown = () => {
      pointerInsideRef.current = true;
      updateInteraction();
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (!node.contains(event.target as Node)) {
        pointerInsideRef.current = false;
        if (!interactionLockRef.current) {
          focusInsideRef.current = false;
          if (menuInteractionRef.current) {
            menuInteractionRef.current = false;
          }
          setAnchorState(null);
          scheduleReposition();
          return;
        }
        updateInteraction();
      }
    };
    const handleFocusIn = () => {
      focusInsideRef.current = true;
      updateInteraction();
    };
    const handleFocusOut = (event: FocusEvent) => {
      const nextFocusInside =
        event.relatedTarget instanceof Node ? node.contains(event.relatedTarget) : false;
      focusInsideRef.current = nextFocusInside;
      updateInteraction();
    };

    node.addEventListener("pointerenter", handlePointerEnter);
    node.addEventListener("pointerleave", handlePointerLeave);
    node.addEventListener("pointerdown", handlePointerDown);
    node.addEventListener("focusin", handleFocusIn);
    node.addEventListener("focusout", handleFocusOut);
    doc.addEventListener("pointerup", handlePointerUp);

    const activeElement = doc.activeElement;
    const activeInside =
      activeElement instanceof Node ? node.contains(activeElement) : false;
    focusInsideRef.current = activeInside;

    let pointerInside = false;
    try {
      pointerInside = node.matches(":hover");
      if (!pointerInside) {
        pointerInside = node.querySelector(":hover") !== null;
      }
    } catch {
      pointerInside = false;
    }
    pointerInsideRef.current = pointerInside;
    updateInteraction();

    return () => {
      clearBlurTimeout();
      node.removeEventListener("pointerenter", handlePointerEnter);
      node.removeEventListener("pointerleave", handlePointerLeave);
      node.removeEventListener("pointerdown", handlePointerDown);
      node.removeEventListener("focusin", handleFocusIn);
      node.removeEventListener("focusout", handleFocusOut);
      doc.removeEventListener("pointerup", handlePointerUp);
      pointerInsideRef.current = false;
      focusInsideRef.current = false;
      menuInteractionRef.current = false;
    };
  }, [scheduleReposition, clearBlurTimeout]);

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
  const hostWindow = anchorState.editor.view.dom.ownerDocument?.defaultView ?? null;
  const viewportWidth = hostWindow?.innerWidth ?? 0;
  const viewportHeight = hostWindow?.innerHeight ?? 0;
  const verticalGap = Math.abs(deltaY) || 8;
  let computedStyle: CSSProperties;

  if (menuRect && viewportWidth > 0 && viewportHeight > 0) {
    // Keep the floating palette fully visible without covering the anchor selection by clamping
    // the computed coordinates within the viewport. When there is not enough room above the
    // selection we fall back to positioning underneath it with the same vertical gap.
    const menuWidth = menuRect.width;
    const menuHeight = menuRect.height;
    const viewportPadding = 12;
    const anchorCenterX = resolvedAnchor.left + resolvedAnchor.width / 2 + deltaX;
    const baseLeft = anchorCenterX - menuWidth / 2;
    const clampedLeft = Math.min(
      Math.max(baseLeft, viewportPadding),
      Math.max(viewportWidth - viewportPadding - menuWidth, viewportPadding)
    );

    const preferredTop = resolvedAnchor.top - verticalGap - menuHeight;
    const hasRoomAbove = preferredTop >= viewportPadding;
    const belowTop = resolvedAnchor.bottom + verticalGap;
    const hasRoomBelow = belowTop + menuHeight <= viewportHeight - viewportPadding;
    let resolvedTop: number;

    if (hasRoomAbove) {
      resolvedTop = Math.max(preferredTop, viewportPadding);
    } else if (hasRoomBelow) {
      resolvedTop = Math.min(belowTop, viewportHeight - viewportPadding - menuHeight);
    } else {
      // Fall back to the closest position that keeps the palette visible and minimizes overlap.
      const topBound = Math.max(viewportPadding, viewportHeight - viewportPadding - menuHeight);
      resolvedTop = Math.min(Math.max(preferredTop, viewportPadding), topBound);
    }

    computedStyle = {
      position: "fixed",
      top: resolvedTop,
      left: clampedLeft,
      zIndex: 20_000,
      pointerEvents: "auto",
      ...style
    };
  } else {
    computedStyle = {
      position: "fixed",
      top: resolvedAnchor.top + deltaY,
      left: resolvedAnchor.left + resolvedAnchor.width / 2 + deltaX,
      transform: "translate(-50%, -100%)",
      zIndex: 20_000,
      pointerEvents: "auto",
      ...style
    };
  }

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
      ref={hostRef}
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
