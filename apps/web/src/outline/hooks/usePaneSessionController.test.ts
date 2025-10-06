import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { EdgeId } from "@thortiq/client-core";
import {
  defaultSessionState,
  type SessionPaneSearchState,
  type SessionPaneState,
  type SessionState,
  type SessionStore
} from "@thortiq/sync-core";

import { usePaneSessionController } from "./usePaneSessionController";

const EDGE_ID = "edge-root" as EdgeId;
const PANE_ID = "outline";

const createSearchState = (
  overrides: Partial<SessionPaneSearchState> = {}
): SessionPaneSearchState => ({
  isOpen: true,
  draft: "query",
  appliedQuery: "query",
  matchedEdgeIds: [EDGE_ID],
  visibleEdgeIds: [EDGE_ID],
  partialEdgeIds: [EDGE_ID],
  stickyEdgeIds: [],
  ...overrides
});

const createInitialState = (
  searchOverrides?: Partial<SessionPaneSearchState>
): SessionState => {
  const base = defaultSessionState();
  const basePane = base.panes[0];
  const pane: SessionPaneState = {
    ...basePane,
    rootEdgeId: EDGE_ID,
    collapsedEdgeIds: [],
    focusHistory: basePane.focusHistory.map((entry) => ({ ...entry })),
    search: createSearchState(searchOverrides)
  } satisfies SessionPaneState;
  return {
    ...base,
    selectedEdgeId: null,
    activePaneId: pane.paneId,
    panes: [pane]
  } satisfies SessionState;
};

const createSessionStoreStub = (initial: SessionState): SessionStore => {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    update: (updater) => {
      const next = updater(state);
      if (next !== state) {
        state = next;
        listeners.forEach((listener) => listener());
      }
    },
    setState: (next) => {
      if (next !== state) {
        state = next;
        listeners.forEach((listener) => listener());
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  } satisfies SessionStore;
};

describe("usePaneSessionController", () => {
  it("removes partial flags and marks expanded edges as sticky", () => {
    const store = createSessionStoreStub(createInitialState());
    const { result } = renderHook(() =>
      usePaneSessionController({ sessionStore: store, paneId: PANE_ID })
    );

    act(() => {
      result.current.setCollapsed(EDGE_ID, false);
    });

    const pane = store.getState().panes[0];
    expect(pane.search?.partialEdgeIds).toEqual([]);
    expect(pane.search?.stickyEdgeIds).toEqual([EDGE_ID]);
    expect(pane.collapsedEdgeIds).toEqual([]);
  });

  it("removes search partial flags when explicitly cleared", () => {
    const store = createSessionStoreStub(createInitialState());
    const { result } = renderHook(() =>
      usePaneSessionController({ sessionStore: store, paneId: PANE_ID })
    );

    act(() => {
      result.current.clearSearchPartialEdge(EDGE_ID);
    });

    const pane = store.getState().panes[0];
    expect(pane.search?.partialEdgeIds).toEqual([]);
  });

  it("removes partial flags while recording collapsed override", () => {
    const store = createSessionStoreStub(createInitialState());
    const { result } = renderHook(() =>
      usePaneSessionController({ sessionStore: store, paneId: PANE_ID })
    );

    act(() => {
      result.current.setCollapsed(EDGE_ID, true);
    });

    const pane = store.getState().panes[0];
    expect(pane.collapsedEdgeIds).toEqual([EDGE_ID]);
    expect(pane.search?.partialEdgeIds).toEqual([]);
  });

  it("retains sticky overrides when collapsing a previously expanded edge", () => {
    const store = createSessionStoreStub(
      createInitialState({
        partialEdgeIds: [],
        stickyEdgeIds: [EDGE_ID]
      })
    );
    const { result } = renderHook(() =>
      usePaneSessionController({ sessionStore: store, paneId: PANE_ID })
    );

    act(() => {
      result.current.setCollapsed(EDGE_ID, true);
    });

    const pane = store.getState().panes[0];
    expect(pane.search?.stickyEdgeIds).toEqual([EDGE_ID]);
  });

  it("clears sticky overrides when partial flags are explicitly cleared", () => {
    const store = createSessionStoreStub(
      createInitialState({
        stickyEdgeIds: [EDGE_ID]
      })
    );
    const { result } = renderHook(() =>
      usePaneSessionController({ sessionStore: store, paneId: PANE_ID })
    );

    act(() => {
      result.current.clearSearchPartialEdge(EDGE_ID);
    });

    const pane = store.getState().panes[0];
    expect(pane.search?.partialEdgeIds).toEqual([]);
    expect(pane.search?.stickyEdgeIds).toEqual([EDGE_ID]);
  });
});
