import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createUserStorageNamespace } from "@thortiq/client-core";

interface ShellLayoutState {
  readonly paneWidth: number;
  readonly lastExpandedWidth: number;
  readonly isCollapsed: boolean;
}

export interface ShellLayoutBounds {
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly collapsedWidth: number;
  readonly defaultWidth: number;
}

interface UpdateOptions {
  readonly persist?: boolean;
}

interface WidthUpdateOptions extends UpdateOptions {
  readonly updateLastExpanded?: boolean;
}

export interface ShellLayoutStateHandle {
  readonly paneWidth: number;
  readonly lastExpandedWidth: number;
  readonly isCollapsed: boolean;
  setPaneWidth(width: number, options?: WidthUpdateOptions): void;
  setLastExpandedWidth(width: number, options?: UpdateOptions): void;
  setIsCollapsed(collapsed: boolean, options?: UpdateOptions): void;
  persist(): void;
}

const STORAGE_SUFFIX = "::layout::shell::v1";

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const createDefaultState = (bounds: ShellLayoutBounds): ShellLayoutState => {
  const width = clamp(bounds.defaultWidth, bounds.minWidth, bounds.maxWidth);
  return {
    paneWidth: bounds.collapsedWidth,
    lastExpandedWidth: width,
    isCollapsed: true
  };
};

const sanitizeState = (state: ShellLayoutState, bounds: ShellLayoutBounds): ShellLayoutState => {
  const collapsed = Boolean(state.isCollapsed);
  const lastExpanded = clamp(
    Number.isFinite(state.lastExpandedWidth) ? state.lastExpandedWidth : bounds.defaultWidth,
    bounds.minWidth,
    bounds.maxWidth
  );
  const paneWidth = collapsed
    ? bounds.collapsedWidth
    : clamp(
        Number.isFinite(state.paneWidth) ? state.paneWidth : lastExpanded,
        bounds.minWidth,
        bounds.maxWidth
      );
  return {
    isCollapsed: collapsed,
    paneWidth,
    lastExpandedWidth: lastExpanded
  };
};

const statesEqual = (a: ShellLayoutState, b: ShellLayoutState): boolean =>
  a.isCollapsed === b.isCollapsed
  && a.paneWidth === b.paneWidth
  && a.lastExpandedWidth === b.lastExpandedWidth;

const buildStorageKey = (userId: string): string => {
  const namespace = createUserStorageNamespace({ userId });
  return `${namespace}${STORAGE_SUFFIX}`;
};

const readStoredState = (
  storageKey: string,
  bounds: ShellLayoutBounds,
  fallback: ShellLayoutState
): ShellLayoutState => {
  if (typeof window === "undefined" || !window.localStorage) {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return fallback;
    }
    const candidate: ShellLayoutState = {
      isCollapsed: Boolean((parsed as Record<string, unknown>).isCollapsed),
      paneWidth: Number((parsed as Record<string, unknown>).paneWidth),
      lastExpandedWidth: Number((parsed as Record<string, unknown>).lastExpandedWidth)
    };
    return sanitizeState(candidate, bounds);
  } catch (error) {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("[shell-layout] failed to read persisted layout state", error);
    }
    return fallback;
  }
};

const writeStoredState = (storageKey: string, state: ShellLayoutState): void => {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch (error) {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("[shell-layout] failed to persist layout state", error);
    }
  }
};

export const useShellLayoutState = (
  userId: string,
  bounds: ShellLayoutBounds
): ShellLayoutStateHandle => {
  const storageKey = useMemo(() => buildStorageKey(userId), [userId]);
  const defaultState = useMemo(() => createDefaultState(bounds), [bounds]);
  const [state, setState] = useState<ShellLayoutState>(() =>
    sanitizeState(readStoredState(storageKey, bounds, defaultState), bounds)
  );
  const latestRef = useRef<ShellLayoutState>(state);

  useEffect(() => {
    const next = sanitizeState(readStoredState(storageKey, bounds, defaultState), bounds);
    latestRef.current = next;
    setState((previous) => (statesEqual(previous, next) ? previous : next));
  }, [bounds, defaultState, storageKey]);

  latestRef.current = state;

  const persistState = useCallback(
    (next: ShellLayoutState) => {
      const sanitised = sanitizeState(next, bounds);
      if (!statesEqual(latestRef.current, sanitised)) {
        latestRef.current = sanitised;
        setState(sanitised);
      }
      writeStoredState(storageKey, sanitised);
    },
    [bounds, storageKey]
  );

  const updateState = useCallback(
    (updater: (current: ShellLayoutState) => ShellLayoutState, options: UpdateOptions = {}) => {
      setState((previous) => {
        const updated = updater(previous);
        const sanitised = sanitizeState(updated, bounds);
        latestRef.current = sanitised;
        if (options.persist) {
          writeStoredState(storageKey, sanitised);
        }
        return statesEqual(previous, sanitised) ? previous : sanitised;
      });
    },
    [bounds, storageKey]
  );

  const setPaneWidth = useCallback(
    (width: number, options: WidthUpdateOptions = {}) => {
      updateState(
        (previous) => {
          if (previous.isCollapsed) {
            // Ignore width updates while collapsed to avoid clobbering the stored expanded width.
            return previous;
          }
          const clamped = clamp(width, bounds.minWidth, bounds.maxWidth);
          const nextLastExpanded =
            options.updateLastExpanded ?? false ? clamped : previous.lastExpandedWidth;
          return {
            isCollapsed: false,
            paneWidth: clamped,
            lastExpandedWidth: nextLastExpanded
          };
        },
        options
      );
    },
    [bounds, updateState]
  );

  const setLastExpandedWidth = useCallback(
    (width: number, options: UpdateOptions = {}) => {
      updateState(
        (previous) => ({
          ...previous,
          lastExpandedWidth: clamp(width, bounds.minWidth, bounds.maxWidth)
        }),
        options
      );
    },
    [bounds, updateState]
  );

  const setIsCollapsed = useCallback(
    (collapsed: boolean, options: UpdateOptions = {}) => {
      updateState(
        (previous) => {
          if (collapsed) {
            if (previous.isCollapsed) {
              return previous;
            }
            return {
              isCollapsed: true,
              paneWidth: bounds.collapsedWidth,
              lastExpandedWidth: previous.lastExpandedWidth
            };
          }
          const restored = clamp(previous.lastExpandedWidth, bounds.minWidth, bounds.maxWidth);
          return {
            isCollapsed: false,
            paneWidth: restored,
            lastExpandedWidth: restored
          };
        },
        options
      );
    },
    [bounds, updateState]
  );

  const persist = useCallback(() => {
    persistState(latestRef.current);
  }, [persistState]);

  return {
    paneWidth: state.paneWidth,
    lastExpandedWidth: state.lastExpandedWidth,
    isCollapsed: state.isCollapsed,
    setPaneWidth,
    setLastExpandedWidth,
    setIsCollapsed,
    persist
  };
};
