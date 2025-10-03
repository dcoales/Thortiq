/**
 * High-level smoke coverage for the outline view to lock in baseline behaviour ahead of the
 * refactor. These tests intentionally exercise the shared provider + view stack without
 * depending on internal implementation details so future decomposition can rely on them.
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
  createOutlineSnapshot,
  getRootEdgeIds,
  moveEdge,
  type OutlineSnapshot
} from "@thortiq/client-core";

interface OutlineReadyPayload {
  readonly snapshot: OutlineSnapshot;
  readonly sync: ReturnType<typeof useSyncContext>;
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
});

describe("outline smoke", () => {
  it("renders the default outline seed", async () => {
    renderOutline();

    const tree = await screen.findByRole("tree");
    await waitFor(() => {
      expect(within(tree).getByText(/Welcome to Thortiq/i).textContent).toMatch(/Welcome to Thortiq/i);
    });

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
});
