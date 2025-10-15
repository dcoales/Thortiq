import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import type { Virtualizer } from "@tanstack/react-virtual";

import { ensurePaneRuntimeState, type PaneRuntimeState } from "@thortiq/client-core";
import type { OutlineStore } from "@thortiq/client-core/outlineStore";

import {
  useOutlineActivePaneId,
  useOutlinePaneIds,
  useOutlineSessionStore,
  useOutlineStore
} from "./OutlineProvider";

const DEFAULT_MIN_PANE_WIDTH = 320;
const DEFAULT_GUTTER_WIDTH = 8;
const KEYBOARD_RESIZE_STEP = 24;
const STACK_BREAKPOINT_PX = 960;
const WIDTH_COMPARISON_EPSILON = 0.0001;

const TAB_LIST_BASE_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0 0 0.75rem",
  borderBottom: "1px solid #e5e7eb",
  flexWrap: "wrap"
};

const TAB_BUTTON_STYLE: CSSProperties = {
  appearance: "none",
  border: "1px solid transparent",
  background: "transparent",
  color: "#4b5563",
  padding: "0.25rem 0.75rem",
  borderRadius: "0.5rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  cursor: "pointer",
  transition: "background-color 120ms ease, color 120ms ease, border-color 120ms ease"
};

const TAB_BUTTON_ACTIVE_STYLE: CSSProperties = {
  background: "#eff6ff",
  borderColor: "#3b82f6",
  color: "#1d4ed8"
};

const HORIZONTAL_CONTENT_STYLE: CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  alignItems: "stretch"
};

const STACKED_CONTENT_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  minWidth: 0
};

interface PaneSize {
  readonly width: number;
  readonly ratio: number;
}

interface DragState {
  readonly pointerId: number;
  readonly leftPaneId: string;
  readonly rightPaneId: string;
  readonly totalWidth: number;
  readonly initialLeftWidth: number;
  readonly initialRightWidth: number;
  readonly originClientX: number;
  lastLeftWidth: number;
  lastRightWidth: number;
}

export type PaneLayoutMode = "horizontal" | "stacked";

export interface PaneRendererProps {
  readonly isActive: boolean;
  readonly layout: PaneLayoutMode;
  readonly onVirtualizerChange: (virtualizer: Virtualizer<HTMLDivElement, Element> | null) => void;
}

export interface PaneManagerProps {
  readonly renderPane: (paneId: string, props: PaneRendererProps) => ReactNode;
  readonly minPaneWidth?: number;
  readonly gutterWidth?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const nearlyEqual = (a: number | null, b: number | null): boolean => {
  if (a === null || b === null) {
    return a === b;
  }
  return Math.abs(a - b) < WIDTH_COMPARISON_EPSILON;
};

const computePaneSizes = (
  paneIds: readonly string[],
  containerWidth: number,
  runtimeByPane: ReadonlyMap<string, PaneRuntimeState | null>,
  minPaneWidth: number,
  draftOverrides: ReadonlyMap<string, PaneSize> | null
): Map<string, PaneSize> => {
  const count = paneIds.length;
  const sizes = new Map<string, PaneSize>();

  if (count === 0) {
    return sizes;
  }
  if (containerWidth <= 0) {
    const equalRatio = 1 / count;
    paneIds.forEach((paneId) => {
      sizes.set(paneId, { width: 0, ratio: equalRatio });
    });
    return sizes;
  }
  if (containerWidth < minPaneWidth * count) {
    const width = containerWidth / count;
    paneIds.forEach((paneId) => {
      sizes.set(paneId, {
        width,
        ratio: clamp(width / containerWidth, 0, 1)
      });
    });
    return applyDraftOverrides(sizes, paneIds, containerWidth, draftOverrides);
  }

  const fallbackRatio = 1 / count;
  const ratios = new Map<string, number>();
  paneIds.forEach((paneId) => {
    const runtime = runtimeByPane.get(paneId);
    const ratio = runtime?.widthRatio ?? fallbackRatio;
    ratios.set(paneId, ratio > 0 ? ratio : fallbackRatio);
  });

  let adjustableIds = [...paneIds];
  let remainingRatio = adjustableIds.reduce((sum, paneId) => sum + (ratios.get(paneId) ?? fallbackRatio), 0);
  let remainingWidth = containerWidth;

  const locked = new Set<string>();

  while (adjustableIds.length > 0 && remainingRatio > 0 && remainingWidth > 0) {
    let lockedThisPass = false;
    for (const paneId of adjustableIds) {
      const ratio = ratios.get(paneId) ?? fallbackRatio;
      if (remainingRatio <= 0) {
        break;
      }
      const candidateWidth = remainingWidth * (ratio / remainingRatio);
      if (candidateWidth < minPaneWidth) {
        sizes.set(paneId, {
          width: minPaneWidth,
          ratio: clamp(minPaneWidth / containerWidth, 0, 1)
        });
        remainingWidth -= minPaneWidth;
        remainingRatio -= ratio;
        locked.add(paneId);
        lockedThisPass = true;
      }
    }
    if (!lockedThisPass) {
      break;
    }
    adjustableIds = adjustableIds.filter((paneId) => !locked.has(paneId));
  }

  if (adjustableIds.length > 0 && remainingRatio > 0 && remainingWidth > 0) {
    for (const paneId of adjustableIds) {
      const ratio = ratios.get(paneId) ?? fallbackRatio;
      const width = remainingWidth * (ratio / remainingRatio);
      sizes.set(paneId, {
        width,
        ratio: clamp(width / containerWidth, 0, 1)
      });
    }
  } else if (adjustableIds.length > 0) {
    const width = clamp(remainingWidth / adjustableIds.length, 0, containerWidth);
    for (const paneId of adjustableIds) {
      sizes.set(paneId, {
        width,
        ratio: clamp(width / containerWidth, 0, 1)
      });
    }
  }

  return applyDraftOverrides(sizes, paneIds, containerWidth, draftOverrides);
};

const applyDraftOverrides = (
  baseSizes: Map<string, PaneSize>,
  paneIds: readonly string[],
  containerWidth: number,
  draftOverrides: ReadonlyMap<string, PaneSize> | null
): Map<string, PaneSize> => {
  if (!draftOverrides || draftOverrides.size === 0) {
    return baseSizes;
  }
  const sizes = new Map(baseSizes);
  let overriddenWidth = 0;
  draftOverrides.forEach((size, paneId) => {
    overriddenWidth += size.width;
    sizes.set(paneId, size);
  });

  const remainingIds = paneIds.filter((paneId) => !draftOverrides.has(paneId));
  const remainingWidth = Math.max(0, containerWidth - overriddenWidth);

  if (remainingIds.length === 0) {
    const totalWidth = Array.from(sizes.values()).reduce((sum, size) => sum + size.width, 0);
    if (totalWidth === 0 || Math.abs(totalWidth - containerWidth) < 0.5) {
      return sizes;
    }
    const scale = containerWidth / totalWidth;
    sizes.forEach((size, paneId) => {
      const width = size.width * scale;
      sizes.set(paneId, {
        width,
        ratio: clamp(containerWidth > 0 ? width / containerWidth : 0, 0, 1)
      });
    });
    return sizes;
  }

  const baseRemainingSum = remainingIds.reduce(
    (sum, paneId) => sum + (sizes.get(paneId)?.width ?? 0),
    0
  );

  for (const paneId of remainingIds) {
    const base = sizes.get(paneId)?.width ?? 0;
    const weight = baseRemainingSum > 0 ? base / baseRemainingSum : 1 / remainingIds.length;
    const width = remainingWidth * weight;
    sizes.set(paneId, {
      width,
      ratio: clamp(containerWidth > 0 ? width / containerWidth : 0, 0, 1)
    });
  }

  const totalWidth = Array.from(sizes.values()).reduce((sum, size) => sum + size.width, 0);
  const widthDelta = containerWidth - totalWidth;
  if (Math.abs(widthDelta) > 0.5) {
    const lastPaneId = paneIds[paneIds.length - 1];
    const current = sizes.get(lastPaneId);
    if (current) {
      const width = clamp(current.width + widthDelta, 0, containerWidth);
      sizes.set(lastPaneId, {
        width,
        ratio: clamp(containerWidth > 0 ? width / containerWidth : 0, 0, 1)
      });
    }
  }

  return sizes;
};

export const PaneManager = ({
  renderPane,
  minPaneWidth = DEFAULT_MIN_PANE_WIDTH,
  gutterWidth = DEFAULT_GUTTER_WIDTH,
  className,
  style
}: PaneManagerProps): JSX.Element => {
  const paneIds = useOutlinePaneIds();
  const activePaneId = useOutlineActivePaneId();
  const outlineStore = useOutlineStore();
  const sessionStore = useOutlineSessionStore();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const paneElementRefs = useRef(new Map<string, HTMLDivElement>());
  const virtualizerRefs = useRef(new Map<string, Virtualizer<HTMLDivElement, Element>>());
  const dragStateRef = useRef<DragState | null>(null);
  const paneMeasureCacheRef = useRef(new Map<string, PaneSize>());

  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [draftOverrides, setDraftOverrides] = useState<Map<string, PaneSize> | null>(null);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      setContainerWidth(0);
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      setContainerWidth(width);
    });
    observer.observe(element, { box: "border-box" });
    return () => observer.disconnect();
  }, []);

  const runtimeSnapshot = useSyncPaneRuntimeMap(outlineStore, paneIds);
  const paneSizes = useMemo(
    () =>
      computePaneSizes(paneIds, containerWidth, runtimeSnapshot, minPaneWidth, draftOverrides),
    [containerWidth, draftOverrides, minPaneWidth, paneIds, runtimeSnapshot]
  );

  useEffect(() => {
    if (paneIds.length <= 1) {
      setDraftOverrides(null);
    }
  }, [paneIds.length]);

  const layoutMode: PaneLayoutMode =
    paneIds.length > 1 && containerWidth > 0 && containerWidth < STACK_BREAKPOINT_PX
      ? "stacked"
      : "horizontal";

  useEffect(() => {
    if (layoutMode === "stacked") {
      setDraftOverrides(null);
    }
  }, [layoutMode]);

  useLayoutEffect(() => {
    const nextCache = new Map<string, PaneSize>();
    for (const paneId of paneIds) {
      const element = paneElementRefs.current.get(paneId);
      const measuredWidth =
        element?.getBoundingClientRect().width ?? paneSizes.get(paneId)?.width ?? 0;
      const ratio =
        containerWidth > 0
          ? measuredWidth / containerWidth
          : paneSizes.get(paneId)?.ratio ?? 0;
      nextCache.set(paneId, {
        width: measuredWidth,
        ratio
      });
    }
    paneMeasureCacheRef.current = nextCache;
  }, [containerWidth, paneIds, paneSizes]);

  const measureFrameRef = useRef<number | null>(null);
  const scheduleMeasureAll = useCallback(() => {
    if (typeof window === "undefined") {
      virtualizerRefs.current.forEach((virtualizer) => {
        virtualizer.measure();
      });
      return;
    }
    if (measureFrameRef.current !== null) {
      return;
    }
    measureFrameRef.current = window.requestAnimationFrame(() => {
      measureFrameRef.current = null;
      virtualizerRefs.current.forEach((virtualizer) => {
        virtualizer.measure();
      });
    });
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && measureFrameRef.current !== null) {
        window.cancelAnimationFrame(measureFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (containerWidth === 0) {
      return;
    }
    scheduleMeasureAll();
  }, [containerWidth, paneIds, scheduleMeasureAll]);

  const registerVirtualizer = useCallback(
    (paneId: string, instance: Virtualizer<HTMLDivElement, Element> | null) => {
      if (instance) {
        virtualizerRefs.current.set(paneId, instance);
        scheduleMeasureAll();
        return;
      }
      virtualizerRefs.current.delete(paneId);
    },
    [scheduleMeasureAll]
  );

  const registerPaneElement = useCallback((paneId: string, element: HTMLDivElement | null) => {
    if (element) {
      paneElementRefs.current.set(paneId, element);
      return;
    }
    paneElementRefs.current.delete(paneId);
  }, []);

  const persistPaneWidth = useCallback(
    (paneId: string, width: number) => {
      const ratio = containerWidth > 0 ? clamp(width / containerWidth, 0, 1) : null;
      outlineStore.updatePaneRuntimeState(paneId, (previous) => {
        const base = ensurePaneRuntimeState(paneId, previous);
        if (nearlyEqual(base.widthRatio, ratio)) {
          return previous ?? base;
        }
        return {
          ...base,
          widthRatio: ratio,
          virtualizerVersion: base.virtualizerVersion + 1
        };
      });
    },
    [containerWidth, outlineStore]
  );

  const finishDrag = useCallback(() => {
    const state = dragStateRef.current;
    dragStateRef.current = null;
    setDraftOverrides(null);
    if (!state) {
      return;
    }
    const leftElement = paneElementRefs.current.get(state.leftPaneId);
    const rightElement = paneElementRefs.current.get(state.rightPaneId);
    const leftWidth =
      leftElement?.getBoundingClientRect().width
      ?? paneMeasureCacheRef.current.get(state.leftPaneId)?.width
      ?? state.lastLeftWidth;
    const rightWidth =
      rightElement?.getBoundingClientRect().width
      ?? paneMeasureCacheRef.current.get(state.rightPaneId)?.width
      ?? state.lastRightWidth;

    persistPaneWidth(state.leftPaneId, leftWidth);
    persistPaneWidth(state.rightPaneId, rightWidth);
    scheduleMeasureAll();
  }, [persistPaneWidth, scheduleMeasureAll]);

  const handleGutterPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state || event.pointerId !== state.pointerId) {
      return;
    }
    event.preventDefault();
    const delta = event.clientX - state.originClientX;
    const minWidth = minPaneWidth;
    const maxLeftWidth = state.totalWidth - minWidth;
    const proposedLeft = clamp(state.initialLeftWidth + delta, minWidth, maxLeftWidth);
    const proposedRight = state.totalWidth - proposedLeft;

    state.lastLeftWidth = proposedLeft;
    state.lastRightWidth = proposedRight;

    if (containerWidth <= 0) {
      return;
    }
    setDraftOverrides(new Map([
      [
        state.leftPaneId,
        {
          width: proposedLeft,
          ratio: clamp(proposedLeft / containerWidth, 0, 1)
        }
      ],
      [
        state.rightPaneId,
        {
          width: proposedRight,
          ratio: clamp(proposedRight / containerWidth, 0, 1)
        }
      ]
    ]));
  }, [containerWidth, minPaneWidth]);

  const handleGutterPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state || event.pointerId !== state.pointerId) {
      return;
    }
    event.preventDefault();
    (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
    finishDrag();
  }, [finishDrag]);

  const handleGutterPointerDown = useCallback((
    paneIndex: number,
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (layoutMode === "stacked") {
      return;
    }
    const leftPaneId = paneIds[paneIndex];
    const rightPaneId = paneIds[paneIndex + 1];
    if (!leftPaneId || !rightPaneId) {
      return;
    }

    const leftSize = paneMeasureCacheRef.current.get(leftPaneId);
    const rightSize = paneMeasureCacheRef.current.get(rightPaneId);
    if (!leftSize || !rightSize) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const totalWidth = leftSize.width + rightSize.width;
    if (totalWidth < minPaneWidth * 2) {
      return;
    }

    const gutterElement = event.currentTarget as HTMLDivElement;
    gutterElement.setPointerCapture(event.pointerId);

    dragStateRef.current = {
      pointerId: event.pointerId,
      leftPaneId,
      rightPaneId,
      totalWidth,
      initialLeftWidth: leftSize.width,
      initialRightWidth: rightSize.width,
      originClientX: event.clientX,
      lastLeftWidth: leftSize.width,
      lastRightWidth: rightSize.width
    };
  }, [layoutMode, minPaneWidth, paneIds]);

  const handleGutterPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state || event.pointerId !== state.pointerId) {
      return;
    }
    (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
    dragStateRef.current = null;
    setDraftOverrides(null);
  }, []);

  const handleActivatePane = useCallback((paneId: string) => {
    sessionStore.update((state) => {
      if (state.activePaneId === paneId) {
        return state;
      }
      const targetPane = state.panesById[paneId];
      if (!targetPane) {
        return state;
      }
      return {
        ...state,
        activePaneId: paneId,
        selectedEdgeId: targetPane.activeEdgeId ?? state.selectedEdgeId
      };
    });
  }, [sessionStore]);

  const adjustPaneWidths = useCallback((leftPaneId: string, rightPaneId: string, delta: number) => {
    const leftSize = paneMeasureCacheRef.current.get(leftPaneId);
    const rightSize = paneMeasureCacheRef.current.get(rightPaneId);
    if (!leftSize || !rightSize) {
      return;
    }
    const totalWidth = leftSize.width + rightSize.width;
    if (totalWidth < minPaneWidth * 2) {
      return;
    }
    const nextLeftWidth = clamp(leftSize.width + delta, minPaneWidth, totalWidth - minPaneWidth);
    const nextRightWidth = totalWidth - nextLeftWidth;
    if (containerWidth <= 0) {
      return;
    }
    paneMeasureCacheRef.current.set(leftPaneId, {
      width: nextLeftWidth,
      ratio: clamp(nextLeftWidth / containerWidth, 0, 1)
    });
    paneMeasureCacheRef.current.set(rightPaneId, {
      width: nextRightWidth,
      ratio: clamp(nextRightWidth / containerWidth, 0, 1)
    });
    persistPaneWidth(leftPaneId, nextLeftWidth);
    persistPaneWidth(rightPaneId, nextRightWidth);
    scheduleMeasureAll();
  }, [containerWidth, minPaneWidth, persistPaneWidth, scheduleMeasureAll]);

  const paneCount = paneIds.length;
  const visiblePaneIds =
    layoutMode === "stacked"
      ? activePaneId
        ? [activePaneId]
        : paneIds.slice(0, 1)
      : paneIds;

  const paneNodes: ReactNode[] = [];
  for (let index = 0; index < visiblePaneIds.length; index += 1) {
    const paneId = visiblePaneIds[index];
    const isActive = paneId === activePaneId;
    const size = paneSizes.get(paneId) ?? { width: 0, ratio: paneCount > 0 ? 1 / paneCount : 1 };
    const basePaneStyle: CSSProperties =
      layoutMode === "horizontal"
        ? {
            flex: `0 0 ${Math.max(size.ratio * 100, 0)}%`,
            minWidth: `${minPaneWidth}px`
          }
        : {
            flex: "1 1 auto",
            minWidth: 0
          };

    const paneStyle: CSSProperties = {
      position: "relative",
      display: "flex",
      flexDirection: "column",
      minHeight: 0,
      ...basePaneStyle
    };

    const tabId = `outline-pane-tab-${paneId}`;
    const panelId = `outline-pane-panel-${paneId}`;

    paneNodes.push(
      <div
        key={paneId}
        id={panelId}
        role="tabpanel"
        aria-labelledby={tabId}
        ref={(element) => registerPaneElement(paneId, element)}
        data-outline-pane-id={paneId}
        style={paneStyle}
      >
        {renderPane(paneId, {
          isActive,
          layout: layoutMode,
          onVirtualizerChange: (virtualizer) => registerVirtualizer(paneId, virtualizer ?? null)
        })}
      </div>
    );

    if (layoutMode === "horizontal" && index < paneIds.length - 1) {
      const gutterPaneId = paneIds[index];
      paneNodes.push(
        <div
          key={`${gutterPaneId}-gutter`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize pane"
          tabIndex={0}
          style={{
            width: `${gutterWidth}px`,
            cursor: "col-resize",
            touchAction: "none",
            alignSelf: "stretch"
          }}
          onPointerDown={(event) => handleGutterPointerDown(index, event)}
          onPointerMove={handleGutterPointerMove}
          onPointerUp={handleGutterPointerUp}
          onPointerLeave={handleGutterPointerMove}
          onPointerCancel={handleGutterPointerCancel}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              adjustPaneWidths(paneId, paneIds[index + 1], -KEYBOARD_RESIZE_STEP);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              adjustPaneWidths(paneId, paneIds[index + 1], KEYBOARD_RESIZE_STEP);
            }
          }}
        />
      );
    }
  }

  const tabList =
    paneCount > 1
      ? (
          <div
            role="tablist"
            aria-orientation="horizontal"
            style={TAB_LIST_BASE_STYLE}
          >
            {paneIds.map((paneId, index) => {
              const isActive = paneId === activePaneId;
              const tabId = `outline-pane-tab-${paneId}`;
              const panelId = `outline-pane-panel-${paneId}`;
              const label = `Pane ${index + 1}`;
              return (
                <button
                  key={paneId}
                  id={tabId}
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  aria-controls={panelId}
                  onClick={() => handleActivatePane(paneId)}
                  style={{
                    ...TAB_BUTTON_STYLE,
                    ...(isActive ? TAB_BUTTON_ACTIVE_STYLE : {})
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )
      : null;

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
        ...style
      }}
    >
      {tabList}
      <div style={layoutMode === "horizontal" ? HORIZONTAL_CONTENT_STYLE : STACKED_CONTENT_STYLE}>
        {paneNodes}
      </div>
    </div>
  );
};

const useSyncPaneRuntimeMap = (
  outlineStore: OutlineStore,
  paneIds: readonly string[]
): ReadonlyMap<string, PaneRuntimeState | null> => {
  const subscribe = useCallback(
    (listener: () => void) => outlineStore.subscribe(listener),
    [outlineStore]
  );
  const getSnapshot = useCallback(() => {
    const entries = new Map<string, PaneRuntimeState | null>();
    paneIds.forEach((paneId) => {
      entries.set(paneId, outlineStore.getPaneRuntimeState(paneId));
    });
    return entries;
  }, [outlineStore, paneIds]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

/** @internal Exported for unit tests. */
export const __private__computePaneSizes = computePaneSizes;
