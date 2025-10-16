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

const DEFAULT_MIN_PANE_WIDTH = 250;
const DEFAULT_GUTTER_WIDTH = 3;
const KEYBOARD_RESIZE_STEP = 24;
const WIDTH_COMPARISON_EPSILON = 0.0001;


const HORIZONTAL_CONTENT_STYLE: CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  alignItems: "stretch",
  overflowX: "auto",
  overflowY: "hidden",
  boxSizing: "border-box"
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
  draftOverrides: ReadonlyMap<string, PaneSize> | null,
  gutterWidth: number
): Map<string, PaneSize> => {
  const count = paneIds.length;
  const sizes = new Map<string, PaneSize>();

  if (count === 0) {
    return sizes;
  }
  
  // Calculate available width accounting for explicit gutters between panes
  const totalGutterSpace = gutterWidth * Math.max(0, count - 1);
  const availableWidth = Math.max(0, containerWidth - totalGutterSpace);
  
  if (containerWidth <= 0) {
    const equalRatio = 1 / count;
    paneIds.forEach((paneId) => {
      sizes.set(paneId, { width: 0, ratio: equalRatio });
    });
    return sizes;
  }
  if (availableWidth < minPaneWidth * count) {
    const width = availableWidth / count;
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
  let remainingWidth = availableWidth;

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
      const width = Math.floor(remainingWidth * (ratio / remainingRatio));
      sizes.set(paneId, {
        width,
        ratio: clamp(width / containerWidth, 0, 1)
      });
    }
  } else if (adjustableIds.length > 0) {
    const width = Math.floor(clamp(remainingWidth / adjustableIds.length, 0, containerWidth));
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
  
  // No CSS gap used; gutters are explicit elements whose width is known

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
      // Use contentBoxSize to get the width minus padding
      const width = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      setContainerWidth(width);
    });
    observer.observe(element, { box: "content-box" });
    return () => observer.disconnect();
  }, []);

  const runtimeSnapshot = useSyncPaneRuntimeMap(outlineStore, paneIds);
  const paneSizes = useMemo(
    () => {
      const sizes = computePaneSizes(paneIds, containerWidth, runtimeSnapshot, minPaneWidth, draftOverrides, gutterWidth);
      if (paneIds.length > 1 && typeof console !== "undefined") {
        console.log("[PaneManager] containerWidth:", containerWidth);
        console.log("[PaneManager] gutterWidth:", gutterWidth);
        console.log("[PaneManager] pane count:", paneIds.length);
        console.log("[PaneManager] calculated sizes:", Array.from(sizes.entries()));
        const totalWidth = Array.from(sizes.values()).reduce((sum, s) => sum + s.width, 0);
        const totalWithGutters = totalWidth + (gutterWidth * (paneIds.length - 1));
        console.log("[PaneManager] total pane widths:", totalWidth);
        console.log("[PaneManager] total with gutters:", totalWithGutters);
        console.log("[PaneManager] overflow:", totalWithGutters - containerWidth);
      }
      return sizes;
    },
    [containerWidth, draftOverrides, gutterWidth, minPaneWidth, paneIds, runtimeSnapshot]
  );

  useEffect(() => {
    if (paneIds.length <= 1) {
      setDraftOverrides(null);
    }
  }, [paneIds.length]);

  const layoutMode: PaneLayoutMode = "horizontal";

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

  const persistWidthRatioToSession = useCallback(
    (paneId: string, ratio: number | null) => {
      sessionStore.update((state) => {
        const pane = state.panesById[paneId];
        if (!pane) {
          return state;
        }
        const sanitisedRatio =
          ratio === null
            ? null
            : clamp(ratio, 0, 1);
        const roundedRatio =
          sanitisedRatio === null
            ? null
            : Math.round(sanitisedRatio * 10000) / 10000;
        const currentRatio = pane.widthRatio ?? null;
        if (nearlyEqual(currentRatio, roundedRatio)) {
          return state;
        }
        const nextPane = {
          ...pane,
          widthRatio: roundedRatio
        };
        return {
          ...state,
          panesById: {
            ...state.panesById,
            [paneId]: nextPane
          }
        };
      });
    },
    [sessionStore]
  );

  const persistPaneWidth = useCallback(
    (paneId: string, width: number) => {
      const ratio = containerWidth > 0 ? clamp(width / containerWidth, 0, 1) : null;
      const roundedRatio = ratio === null ? null : Math.round(ratio * 10000) / 10000;
      outlineStore.updatePaneRuntimeState(paneId, (previous) => {
        const base = ensurePaneRuntimeState(paneId, previous);
        if (nearlyEqual(base.widthRatio, roundedRatio)) {
          return previous ?? base;
        }
        return {
          ...base,
          widthRatio: roundedRatio,
          virtualizerVersion: base.virtualizerVersion + 1
        };
      });
      persistWidthRatioToSession(paneId, roundedRatio);
    },
    [containerWidth, outlineStore, persistWidthRatioToSession]
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
  }, [minPaneWidth, paneIds]);

  const handleGutterPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state || event.pointerId !== state.pointerId) {
      return;
    }
    (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
    dragStateRef.current = null;
    setDraftOverrides(null);
  }, []);

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
  const visiblePaneIds = paneIds;

  const paneNodes: ReactNode[] = [];
  for (let index = 0; index < visiblePaneIds.length; index += 1) {
    const paneId = visiblePaneIds[index];
    const isActive = paneId === activePaneId;
    const size = paneSizes.get(paneId) ?? { width: 0, ratio: paneCount > 0 ? 1 / paneCount : 1 };
    const basePaneStyle: CSSProperties = {
      width: `${Math.max(size.width, minPaneWidth)}px`,
      minWidth: `${minPaneWidth}px`,
      flexShrink: 0,
      flexGrow: 0
    };

    const paneStyle: CSSProperties = {
      position: "relative",
      display: "flex",
      flexDirection: "column",
      minHeight: 0,
      ...basePaneStyle
    };

    paneNodes.push(
      <div
        key={paneId}
        role="group"
        aria-label={`Outline pane ${index + 1}`}
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
            alignSelf: "stretch",
            backgroundColor: "#d1d5db",
            flexShrink: 0
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
      <div style={HORIZONTAL_CONTENT_STYLE}>
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
  const snapshotRef = useRef<ReadonlyMap<string, PaneRuntimeState | null>>(new Map());
  const idsRef = useRef<readonly string[]>([]);
  const getSnapshot = useCallback(() => {
    const previousSnapshot = snapshotRef.current;
    const previousIds = idsRef.current;
    let snapshotChanged =
      previousIds.length !== paneIds.length ||
      previousSnapshot.size !== paneIds.length;

    if (!snapshotChanged) {
      for (let index = 0; index < paneIds.length; index += 1) {
        if (previousIds[index] !== paneIds[index]) {
          snapshotChanged = true;
          break;
        }
      }
    }

    const nextSnapshot = new Map<string, PaneRuntimeState | null>();
    paneIds.forEach((paneId) => {
      const runtimeState = outlineStore.getPaneRuntimeState(paneId);
      nextSnapshot.set(paneId, runtimeState);
      if (!snapshotChanged && previousSnapshot.get(paneId) !== runtimeState) {
        snapshotChanged = true;
      }
    });

    if (!snapshotChanged) {
      return previousSnapshot;
    }

    snapshotRef.current = nextSnapshot;
    idsRef.current = paneIds.slice();
    return nextSnapshot;
  }, [outlineStore, paneIds]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

/** @internal Exported for unit tests. */
export const __private__computePaneSizes = computePaneSizes;
