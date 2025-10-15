import { describe, expect, it } from "vitest";

import { closePane, ensureNeighborPane, focusPane, openPaneRightOf } from "../paneCommands";
import { defaultSessionState, type SessionState } from "@thortiq/sync-core";
import type { EdgeId } from "../../ids";

const assignActiveEdge = (
  state: SessionState,
  paneId: string,
  activeEdgeId: EdgeId | null
): SessionState => {
  const pane = state.panesById[paneId];
  if (!pane) {
    throw new Error(`Pane ${paneId} not found`);
  }
  return {
    ...state,
    panesById: {
      ...state.panesById,
      [paneId]: {
        ...pane,
        activeEdgeId
      }
    }
  };
};

describe("paneCommands.closePane", () => {
  it("prefers the left neighbour when closing the active pane", () => {
    let state = defaultSessionState();
    const first = openPaneRightOf(state, state.paneOrder[0]);
    state = first.state;
    const second = openPaneRightOf(state, first.paneId);
    state = second.state;

    const [outlineId, leftPaneId, rightPaneId] = state.paneOrder;
    state = assignActiveEdge(state, outlineId, "edge-outline" as EdgeId);
    state = assignActiveEdge(state, leftPaneId, "edge-left" as EdgeId);
    state = assignActiveEdge(state, rightPaneId, "edge-right" as EdgeId);
    state = {
      ...state,
      selectedEdgeId: state.panesById[state.activePaneId]?.activeEdgeId ?? null
    };

    const result = closePane(state, rightPaneId);

    expect(result.didClose).toBe(true);
    expect(result.nextActivePaneId).toBe(leftPaneId);
    expect(result.state.paneOrder).toEqual([outlineId, leftPaneId]);
    expect(result.state.activePaneId).toBe(leftPaneId);
    expect(result.state.selectedEdgeId).toBe("edge-left");
  });

  it("falls back to the right neighbour when the first pane is closed", () => {
    let state = defaultSessionState();
    const first = openPaneRightOf(state, state.paneOrder[0]);
    state = first.state;

    const [outlineId, rightPaneId] = state.paneOrder;
    state = assignActiveEdge(state, outlineId, "edge-outline" as EdgeId);
    state = assignActiveEdge(state, rightPaneId, "edge-right" as EdgeId);
    state = {
      ...state,
      activePaneId: outlineId,
      selectedEdgeId: "edge-outline" as EdgeId
    };

    const result = closePane(state, outlineId);

    expect(result.didClose).toBe(true);
    expect(result.nextActivePaneId).toBe(rightPaneId);
    expect(result.state.paneOrder).toEqual([rightPaneId]);
    expect(result.state.activePaneId).toBe(rightPaneId);
    expect(result.state.selectedEdgeId).toBe("edge-right");
  });

  it("leaves the active pane untouched when closing a neighbour", () => {
    let state = defaultSessionState();
    const first = openPaneRightOf(state, state.paneOrder[0]);
    state = first.state;
    const ensure = ensureNeighborPane(state, first.paneId);
    state = ensure.state;

    const [outlineId, leftPaneId, rightPaneId] = state.paneOrder;
    state = assignActiveEdge(state, outlineId, "edge-outline" as EdgeId);
    state = assignActiveEdge(state, leftPaneId, "edge-left" as EdgeId);
    state = assignActiveEdge(state, rightPaneId, "edge-right" as EdgeId);
    state = {
      ...state,
      activePaneId: outlineId,
      selectedEdgeId: "edge-outline" as EdgeId
    };

    const result = closePane(state, rightPaneId);

    expect(result.didClose).toBe(true);
    expect(result.state.activePaneId).toBe(outlineId);
    expect(result.state.selectedEdgeId).toBe("edge-outline");
    expect(result.state.paneOrder).toEqual([outlineId, leftPaneId]);
  });

  it("refuses to close the final remaining pane", () => {
    const state = defaultSessionState();
    const result = closePane(state, "outline");
    expect(result.didClose).toBe(false);
    expect(result.state).toBe(state);
  });

  it("focusPane updates active pane selection without altering pane ordering", () => {
    const base = defaultSessionState();
    const { state: withNeighbor, paneId } = openPaneRightOf(base, "outline", {
      focusEdgeId: "edge-b" as EdgeId
    });

    const result = focusPane(withNeighbor, paneId, {
      edgeId: "edge-c" as EdgeId,
      focusPathEdgeIds: ["edge-c" as EdgeId],
      makeActive: true
    });

    expect(result.didChange).toBe(true);
    expect(result.state.paneOrder).toEqual(withNeighbor.paneOrder);
    expect(result.state.activePaneId).toBe(paneId);
    expect(result.state.selectedEdgeId).toBe("edge-c");
    expect(result.state.panesById[paneId]?.activeEdgeId).toBe("edge-c");
  });

  it("ensureNeighborPane reuses the existing right neighbour when present", () => {
    const base = defaultSessionState();
    const first = openPaneRightOf(base, "outline");
    const second = openPaneRightOf(first.state, first.paneId);

    const result = ensureNeighborPane(second.state, "outline");
    expect(result.created).toBe(false);
    const expectedNeighbourId = second.state.paneOrder[1];
    expect(result.paneId).toBe(expectedNeighbourId);
    expect(result.state).toBe(second.state);
  });
});
