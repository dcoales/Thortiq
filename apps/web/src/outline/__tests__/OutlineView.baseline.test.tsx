/**
 * Baseline integration coverage for the web OutlineView component. These tests lock in the
 * observable behaviour that the refactor must preserve (rendering, selection, drag/drop, and
 * virtualization) while staying agnostic of internal implementation details so we can safely
 * recompose the view later.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { useEffect, useRef } from "react";

import {
  OutlineProvider,
  useOutlineSnapshot,
  useSyncContext
} from "../OutlineProvider";
import { OutlineView } from "../OutlineView";
import {
  createMirrorEdge,
  createOutlineSnapshot,
  getRootEdgeIds,
  moveEdge,
  type OutlineSnapshot
} from "@thortiq/client-core";
import { insertSiblingBelow } from "@thortiq/outline-commands";

interface OutlineReadyPayload {
  readonly snapshot: OutlineSnapshot;
  readonly sync: ReturnType<typeof useSyncContext>;
}

interface TestGlobals {
  __THORTIQ_PROSEMIRROR_TEST__?: boolean;
  __THORTIQ_OUTLINE_VIRTUAL_FALLBACK__?: boolean;
}

const OutlineReady = ({ onReady }: { readonly onReady: (payload: OutlineReadyPayload) => void }) => {
  const snapshot = useOutlineSnapshot();
  const sync = useSyncContext();
  const hasReported = useRef(false);

  useEffect(() => {
    if (hasReported.current) {
      return;
    }
    if (snapshot.rootEdgeIds.length === 0) {
      return;
    }
    hasReported.current = true;
    onReady({ snapshot, sync });
  }, [onReady, snapshot, sync]);

  return null;
};

const renderOutline = (onReady?: (payload: OutlineReadyPayload) => void) => {
  return render(
    <OutlineProvider>
      {onReady ? <OutlineReady onReady={onReady} /> : null}
      <OutlineView paneId="outline" />
    </OutlineProvider>
  );
};

afterEach(() => {
  cleanup();
  const globals = globalThis as TestGlobals;
  delete globals.__THORTIQ_OUTLINE_VIRTUAL_FALLBACK__;
  delete globals.__THORTIQ_PROSEMIRROR_TEST__;
});

describe("OutlineView baseline", () => {

  it("renders the default outline seed", async () => {
    renderOutline();

    const tree = await screen.findByRole("tree");
    const welcomeNode = await within(tree).findByText(/Welcome to Thortiq/i);
    expect(welcomeNode.textContent).toMatch(/Welcome to Thortiq/i);

    const items = within(tree).getAllByRole("treeitem");
    expect(items.length).toBeGreaterThan(0);
  });

  it("reflects Yjs structural reorders triggered by moveEdge", async () => {
    let readyState: OutlineReadyPayload | null = null;
    renderOutline((payload) => {
      readyState = payload;
    });

    await screen.findByRole("tree");
    await waitFor(() => {
      expect(readyState).not.toBeNull();
    });

    const getRowByText = (pattern: RegExp) => {
      const textNode = screen.getByText(pattern);
      const row = textNode.closest('[role="treeitem"]') as HTMLElement | null;
      expect(row).not.toBeNull();
      return row as HTMLElement;
    };

    const childRow = getRowByText(/Phase 1 focuses/i);
    expect(childRow.getAttribute("aria-level")).toBe("2");

    const { sync } = readyState!;
    const latestSnapshot = createOutlineSnapshot(sync.outline);
    const childEdgeEntry = Array.from(latestSnapshot.edges.values()).find((edge) => {
      const node = latestSnapshot.nodes.get(edge.childNodeId);
      return node?.text.includes("Phase 1 focuses");
    });
    expect(childEdgeEntry).toBeDefined();

    const rootPosition = getRootEdgeIds(sync.outline).length;

    await act(async () => {
      moveEdge(sync.outline, childEdgeEntry!.id, null, rootPosition, sync.localOrigin);
    });

    await waitFor(() => {
      const reorderedRow = getRowByText(/Phase 1 focuses/i);
      expect(reorderedRow.getAttribute("aria-level")).toBe("1");
    });
  });

  it("inserts a sibling node when Enter is pressed", async () => {
    renderOutline();

    const tree = await screen.findByRole("tree");
    const rows = within(tree).getAllByRole("treeitem");
    const firstRow = rows[0];

    fireEvent.mouseDown(firstRow);
    await waitFor(() => {
      expect(firstRow.getAttribute("aria-selected")).toBe("true");
    });

    await act(async () => {
      fireEvent.keyDown(tree, { key: "Enter" });
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Untitled node/i).length).toBeGreaterThan(0);
    });
  });

  it("renders mirror parents with unique child edge ids", async () => {
    let readyState: OutlineReadyPayload | null = null;
    renderOutline((payload) => {
      readyState = payload;
    });

    const tree = await screen.findByRole("tree");
    await waitFor(() => {
      expect(readyState).not.toBeNull();
    });

    const { snapshot, sync } = readyState!;
    const originalRootEdgeId = snapshot.rootEdgeIds[0];
    expect(originalRootEdgeId).toBeDefined();
    const originalRootNodeId = snapshot.edges.get(originalRootEdgeId!)?.childNodeId;
    expect(originalRootNodeId).toBeDefined();

    let mirrorResult: ReturnType<typeof createMirrorEdge> | null = null;
    await act(async () => {
      mirrorResult = createMirrorEdge({
        outline: sync.outline,
        mirrorNodeId: originalRootNodeId!,
        insertParentNodeId: null,
        insertIndex: 1,
        origin: sync.localOrigin
      });
    });

    expect(mirrorResult).not.toBeNull();
    const mirrorEdgeId = mirrorResult!.edgeId;

    await waitFor(() => {
      expect(
        tree.querySelector(`[data-outline-row="true"][data-edge-id="${mirrorEdgeId}"]`)
      ).toBeTruthy();
    });

    const updatedSnapshot = createOutlineSnapshot(sync.outline);
    const originalChildren = updatedSnapshot.childEdgeIdsByParentEdge.get(originalRootEdgeId!) ?? [];
    const mirrorChildren = updatedSnapshot.childEdgeIdsByParentEdge.get(mirrorEdgeId) ?? [];

    expect(originalChildren.length).toBeGreaterThan(0);
    expect(mirrorChildren.length).toBe(originalChildren.length);
    expect(mirrorChildren).not.toEqual(originalChildren);

    const originalChildRow = tree.querySelector(
      `[data-outline-row="true"][data-edge-id="${originalChildren[0]!}"]`
    );
    const mirrorChildRow = tree.querySelector(
      `[data-outline-row="true"][data-edge-id="${mirrorChildren[0]!}"]`
    );

    expect(originalChildRow).toBeTruthy();
    expect(mirrorChildRow).toBeTruthy();
    expect(originalChildren[0]).not.toBe(mirrorChildren[0]);
    expect(originalChildRow?.textContent?.trim()).toBe(mirrorChildRow?.textContent?.trim());
  });

  it("renders all rows when the virtualization fallback is active", async () => {
    const globals = globalThis as TestGlobals;
    const previousFallback = globals.__THORTIQ_OUTLINE_VIRTUAL_FALLBACK__;
    const previousProsemirrorFlag = globals.__THORTIQ_PROSEMIRROR_TEST__;
    globals.__THORTIQ_OUTLINE_VIRTUAL_FALLBACK__ = true;
    globals.__THORTIQ_PROSEMIRROR_TEST__ = false;

    let readyState: OutlineReadyPayload | null = null;
    renderOutline((payload) => {
      readyState = payload;
    });

    await screen.findByRole("tree");
    await waitFor(() => {
      expect(readyState).not.toBeNull();
    });

    const { sync } = readyState!;
    const commandContext = { outline: sync.outline, origin: sync.localOrigin } as const;
    const rootEdges = getRootEdgeIds(sync.outline);
    expect(rootEdges.length).toBeGreaterThan(0);

    let cursorEdgeId = rootEdges[rootEdges.length - 1];
    await act(async () => {
      for (let index = 0; index < 60; index += 1) {
        const result = insertSiblingBelow(commandContext, cursorEdgeId);
        cursorEdgeId = result.edgeId;
      }
    });

    const snapshot = createOutlineSnapshot(sync.outline);
    const totalEdgeCount = snapshot.edges.size;
    expect(totalEdgeCount).toBeGreaterThan(20);

    await waitFor(() => {
      const renderedRows = screen.queryAllByRole("treeitem");
      expect(renderedRows.length).toBeGreaterThan(0);
      expect(renderedRows.length).toBe(totalEdgeCount);
    });

    const tree = screen.getByRole("tree");
    const fallBackRows = within(tree).getAllByRole("treeitem");
    fallBackRows.forEach((row) => {
      expect(row.getAttribute("data-index")).toBeNull();
    });

    if (typeof previousFallback === "undefined") {
      delete globals.__THORTIQ_OUTLINE_VIRTUAL_FALLBACK__;
    } else {
      globals.__THORTIQ_OUTLINE_VIRTUAL_FALLBACK__ = previousFallback;
    }
    if (typeof previousProsemirrorFlag === "undefined") {
      delete globals.__THORTIQ_PROSEMIRROR_TEST__;
    } else {
      globals.__THORTIQ_PROSEMIRROR_TEST__ = previousProsemirrorFlag;
    }
  });
});
