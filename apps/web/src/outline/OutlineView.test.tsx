import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react-dom/test-utils";

import {
  OutlineProvider,
  useOutlineSnapshot,
  useSyncContext,
  useSyncStatus,
  useOutlineSessionStore,
  type OutlineProviderOptions,
  type SessionStore
} from "./OutlineProvider";
import { OutlineView } from "./OutlineView";
import { createWebsocketProviderFactory } from "./websocketProvider";
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import {
  addEdge,
  createNode,
  type EdgeId,
  type SyncAwarenessState,
  type SyncManager
} from "@thortiq/client-core";
import {
  applyNumberedLayoutCommand,
  applyParagraphLayoutCommand
} from "@thortiq/outline-commands";

const ensurePointerEvent = () => {
  if (typeof window.PointerEvent === "undefined") {
    class PolyfillPointerEvent extends MouseEvent {
      readonly pointerId: number;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }

    (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent = PolyfillPointerEvent as unknown as typeof PointerEvent;
  }
};

const mockBoundingClientRect = (
  element: Element,
  rect: { top: number; left: number; right: number; bottom: number }
): void => {
  const domRect = {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({})
  } satisfies DOMRect;

  Object.defineProperty(element, "getBoundingClientRect", {
    value: () => domRect,
    configurable: true
  });
};

const SyncCapture = ({ onReady }: { readonly onReady: (sync: SyncManager) => void }) => {
  const sync = useSyncContext();
  useEffect(() => {
    onReady(sync);
  }, [onReady, sync]);
  return null;
};

const SessionStoreCapture = ({ onReady }: { readonly onReady: (store: SessionStore) => void }) => {
  const sessionStore = useOutlineSessionStore();
  useEffect(() => {
    onReady(sessionStore);
  }, [onReady, sessionStore]);
  return null;
};

const RemotePresence = ({ focusIndex = 0 }: { readonly focusIndex?: number }) => {
  const sync = useSyncContext();
  const snapshot = useOutlineSnapshot();
  const targetEdgeId = snapshot.rootEdgeIds[focusIndex] ?? null;

  useEffect(() => {
    if (!targetEdgeId) {
      return;
    }
    const remoteClientId = sync.awareness.clientID + 1;
    const state: SyncAwarenessState = {
      userId: "remote-user",
      displayName: "Remote User",
      color: "#f97316",
      focusEdgeId: targetEdgeId,
      selection: { anchorEdgeId: targetEdgeId, headEdgeId: targetEdgeId }
    };
    const nextClock = (sync.awareness.meta.get(remoteClientId)?.clock ?? 0) + 1;
    sync.awareness.meta.set(remoteClientId, { clock: nextClock, lastUpdated: Date.now() });
    sync.awareness.states.set(remoteClientId, state);
    const addedPayload = { added: [remoteClientId], updated: [], removed: [] };
    sync.awareness.emit("change", [addedPayload, "test"]);
    sync.awareness.emit("update", [addedPayload, "test"]);
    return () => {
      const cleanupClock = (sync.awareness.meta.get(remoteClientId)?.clock ?? 0) + 1;
      sync.awareness.meta.set(remoteClientId, { clock: cleanupClock, lastUpdated: Date.now() });
      sync.awareness.states.delete(remoteClientId);
      const removedPayload = { added: [], updated: [], removed: [remoteClientId] };
      sync.awareness.emit("change", [removedPayload, "test"]);
      sync.awareness.emit("update", [removedPayload, "test"]);
    };
  }, [sync, targetEdgeId]);

  return null;
};

const SyncStatusProbe = () => {
  const status = useSyncStatus();
  return <div data-testid="sync-status">{status}</div>;
};

describe("OutlineView", () => {
  it("renders seeded outline rows", async () => {
    render(
      <OutlineProvider>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const welcome = await screen.findByText(/Welcome to Thortiq/i);
    expect(welcome.textContent).toContain("Welcome to Thortiq");
  });

  it("runs basic outline commands via keyboard", async () => {
    render(
      <OutlineProvider>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    const initialItems = within(tree).getAllByRole("treeitem");
    expect(initialItems.length).toBeGreaterThanOrEqual(4);

    await act(async () => {
      fireEvent.keyDown(tree, { key: "Enter" });
    });

    await waitFor(() => {
      const placeholders = tree.querySelectorAll('[data-outline-text-placeholder="true"]');
      expect(placeholders.length).toBeGreaterThan(0);
    });
    const afterInsertItems = within(tree).getAllByRole("treeitem");
    expect(afterInsertItems.length).toBe(initialItems.length + 1);

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "Tab" });

    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    fireEvent.keyDown(tree, { key: "ArrowRight" });

    fireEvent.keyDown(tree, { key: "Enter", shiftKey: true });

    const placeholderNodes = tree.querySelectorAll('[data-outline-text-placeholder="true"]');
    expect(placeholderNodes.length).toBeGreaterThan(0);
  });

  it("allows clicking a row to select it", async () => {
    render(
      <OutlineProvider>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const treeItems = await screen.findAllByRole("treeitem");
    const secondRow = treeItems[1];

    fireEvent.mouseDown(secondRow);

    expect(secondRow.getAttribute("aria-selected")).toBe("true");
  });

  it("allows dragging across rows to select multiple nodes", async () => {
    ensurePointerEvent();

    render(
      <OutlineProvider>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const treeItems = await screen.findAllByRole("treeitem");
    expect(treeItems.length).toBeGreaterThanOrEqual(2);
    const firstRow = treeItems[0];
    const secondRow = treeItems[1];

    const originalElementFromPoint = document.elementFromPoint;
    let currentElement: Element | null = null;
    document.elementFromPoint = (x: number, y: number) => {
      return currentElement ?? originalElementFromPoint.call(document, x, y);
    };

    try {
      await act(async () => {
        fireEvent.pointerDown(firstRow, {
          pointerId: 7,
          button: 0,
          isPrimary: true,
          clientX: 12,
          clientY: 12
        });
      });

      await waitFor(() => {
        expect(firstRow.getAttribute("aria-selected")).toBe("true");
      });

      currentElement = secondRow;
      await act(async () => {
        window.dispatchEvent(
          new window.PointerEvent("pointermove", {
            pointerId: 7,
            clientX: 18,
            clientY: 60
          })
        );
      });

      await waitFor(() => {
        expect(firstRow.getAttribute("aria-selected")).toBe("true");
        expect(secondRow.getAttribute("aria-selected")).toBe("true");
      });

      act(() => {
        window.dispatchEvent(new window.PointerEvent("pointerup", { pointerId: 7 }));
      });
    } finally {
      currentElement = null;
      document.elementFromPoint = originalElementFromPoint;
    }
  });

  it("renders ancestor guidelines and toggles child collapse state", async () => {
    ensurePointerEvent();

    const seedOutline: OutlineProviderOptions["seedOutline"] = (sync) => {
      const { outline, localOrigin } = sync;
      const root = createNode(outline, { text: "Parent", origin: localOrigin });
      addEdge(outline, { parentNodeId: null, childNodeId: root, origin: localOrigin });

      const childA = createNode(outline, { text: "Child A", origin: localOrigin });
      const childB = createNode(outline, { text: "Child B", origin: localOrigin });
      addEdge(outline, { parentNodeId: root, childNodeId: childA, origin: localOrigin });
      addEdge(outline, { parentNodeId: root, childNodeId: childB, origin: localOrigin });

      const grandchildA = createNode(outline, { text: "Grandchild A", origin: localOrigin });
      const grandchildB = createNode(outline, { text: "Grandchild B", origin: localOrigin });
      addEdge(outline, { parentNodeId: childA, childNodeId: grandchildA, origin: localOrigin });
      addEdge(outline, { parentNodeId: childB, childNodeId: grandchildB, origin: localOrigin });
    };

    render(
      <OutlineProvider options={{ skipDefaultSeed: true, seedOutline }}>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const childRow = await screen.findByText("Child A");
    const rowElement = childRow.closest('[data-outline-row="true"]');
    expect(rowElement).not.toBeNull();
    const guidelineButton = rowElement?.querySelector<HTMLButtonElement>(
      'button[data-outline-guideline="true"]'
    );
    expect(guidelineButton).not.toBeNull();

    const guidelineLine = guidelineButton?.querySelector<HTMLSpanElement>('span[aria-hidden="true"]');
    expect(guidelineLine?.style.width).toBe("2px");

    fireEvent.pointerEnter(guidelineButton!, { pointerId: 11 });
    await waitFor(() => {
      expect(guidelineLine?.style.width).toBe("4px");
    });

    fireEvent.pointerLeave(guidelineButton!, { pointerId: 11 });
    await waitFor(() => {
      expect(guidelineLine?.style.width).toBe("2px");
  });

  await screen.findByText("Grandchild A");
  await screen.findByText("Grandchild B");

  fireEvent.click(guidelineButton!);

  await waitFor(() => {
    expect(screen.queryByText("Grandchild A")).toBeNull();
  });
  await waitFor(() => {
    expect(screen.queryByText("Grandchild B")).toBeNull();
  });

  fireEvent.click(guidelineButton!);

  await screen.findByText("Grandchild A");
  await screen.findByText("Grandchild B");
});

  it("renders numbered bullets with undo/redo continuity", async () => {
    let childEdges: EdgeId[] = [];
    const seedOutline: OutlineProviderOptions["seedOutline"] = (sync) => {
      const { outline, localOrigin } = sync;
      const rootNodeId = createNode(outline, { text: "Plan", origin: localOrigin });
      addEdge(outline, { parentNodeId: null, childNodeId: rootNodeId, origin: localOrigin });

      const firstChildNodeId = createNode(outline, { text: "First step", origin: localOrigin });
      const firstChildEdgeId = addEdge(outline, {
        parentNodeId: rootNodeId,
        childNodeId: firstChildNodeId,
        origin: localOrigin
      }).edgeId;

      const secondChildNodeId = createNode(outline, { text: "Second step", origin: localOrigin });
      const secondChildEdgeId = addEdge(outline, {
        parentNodeId: rootNodeId,
        childNodeId: secondChildNodeId,
        origin: localOrigin
      }).edgeId;

      childEdges = [firstChildEdgeId, secondChildEdgeId];
    };

    let syncManager: SyncManager | null = null;
    const handleSyncCapture = (sync: SyncManager) => {
      if (!syncManager) {
        syncManager = sync;
      }
    };

    render(
      <OutlineProvider options={{ skipDefaultSeed: true, seedOutline }}>
        <SyncCapture onReady={handleSyncCapture} />
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    await waitFor(() => {
      expect(syncManager).not.toBeNull();
    });

    act(() => {
      syncManager!.undoManager.clear();
    });

    const tree = await screen.findByRole("tree");
    await screen.findByText("First step");
    await screen.findByText("Second step");

    const getBulletForEdge = (edgeId: EdgeId): HTMLButtonElement => {
      const row = tree.querySelector<HTMLElement>(`[data-edge-id="${edgeId}"]`);
      if (!row) {
        throw new Error(`Row for edge ${edgeId} not found`);
      }
      return within(row).getByLabelText("Focus node");
    };

    const [firstEdgeId, secondEdgeId] = childEdges;
    expect(getBulletForEdge(firstEdgeId).textContent).toBe("•");
    expect(getBulletForEdge(secondEdgeId).textContent).toBe("•");

    act(() => {
      const result = applyNumberedLayoutCommand(
        { outline: syncManager!.outline, origin: syncManager!.localOrigin },
        childEdges
      );
      expect(result?.length).toBe(childEdges.length);
    });

    await waitFor(() => {
      expect(getBulletForEdge(firstEdgeId).textContent).toBe("1.");
      expect(getBulletForEdge(secondEdgeId).textContent).toBe("2.");
    });

    act(() => {
      syncManager!.undoManager.undo();
    });

    await waitFor(() => {
      expect(getBulletForEdge(firstEdgeId).textContent).toBe("•");
      expect(getBulletForEdge(secondEdgeId).textContent).toBe("•");
    });

    act(() => {
      syncManager!.undoManager.redo();
    });

    await waitFor(() => {
      expect(getBulletForEdge(firstEdgeId).textContent).toBe("1.");
      expect(getBulletForEdge(secondEdgeId).textContent).toBe("2.");
    });
  });

  it("hides paragraph bullets until hover and restores visibility after undo", async () => {
    ensurePointerEvent();

    let paragraphEdge: EdgeId | null = null;
    const seedOutline: OutlineProviderOptions["seedOutline"] = (sync) => {
      const { outline, localOrigin } = sync;
      const rootNodeId = createNode(outline, { text: "Writeup", origin: localOrigin });
      addEdge(outline, { parentNodeId: null, childNodeId: rootNodeId, origin: localOrigin });

      const paragraphNodeId = createNode(outline, { text: "Narrative section", origin: localOrigin });
      paragraphEdge = addEdge(outline, {
        parentNodeId: rootNodeId,
        childNodeId: paragraphNodeId,
        origin: localOrigin
      }).edgeId;

      const siblingNodeId = createNode(outline, { text: "Follow-up tasks", origin: localOrigin });
      addEdge(outline, { parentNodeId: rootNodeId, childNodeId: siblingNodeId, origin: localOrigin });
    };

    let syncManager: SyncManager | null = null;
    const handleSyncCapture = (sync: SyncManager) => {
      if (!syncManager) {
        syncManager = sync;
      }
    };

    render(
      <OutlineProvider options={{ skipDefaultSeed: true, seedOutline }}>
        <SyncCapture onReady={handleSyncCapture} />
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    await waitFor(() => {
      expect(syncManager).not.toBeNull();
      expect(paragraphEdge).not.toBeNull();
    });

    act(() => {
      syncManager!.undoManager.clear();
    });

    const tree = await screen.findByRole("tree");
    await screen.findByText("Narrative section");

    const getRow = (edgeId: EdgeId): HTMLElement => {
      const row = tree.querySelector<HTMLElement>(`[data-edge-id="${edgeId}"]`);
      if (!row) {
        throw new Error(`Row for edge ${edgeId} not found`);
      }
      return row;
    };

    const paragraphRow = getRow(paragraphEdge!);
    const paragraphBullet = within(paragraphRow).getByLabelText("Focus node");
    expect(paragraphBullet.style.opacity).toBe("1");

    act(() => {
      const result = applyParagraphLayoutCommand(
        { outline: syncManager!.outline, origin: syncManager!.localOrigin },
        [paragraphEdge!]
      );
      expect(result?.length).toBe(1);
    });

    await waitFor(() => {
      const bullet = within(getRow(paragraphEdge!)).getByLabelText("Focus node");
      expect(bullet.style.opacity).toBe("0");
    });

    act(() => {
      fireEvent.pointerEnter(getRow(paragraphEdge!), { pointerId: 42 });
    });

    await waitFor(() => {
      const bullet = within(getRow(paragraphEdge!)).getByLabelText("Focus node");
      expect(bullet.style.opacity).toBe("1");
    });

    act(() => {
      fireEvent.pointerLeave(getRow(paragraphEdge!), { pointerId: 42, buttons: 0 });
    });

    await waitFor(() => {
      const bullet = within(getRow(paragraphEdge!)).getByLabelText("Focus node");
      expect(bullet.style.opacity).toBe("0");
    });

    act(() => {
      syncManager!.undoManager.undo();
    });

    await waitFor(() => {
      const bullet = within(getRow(paragraphEdge!)).getByLabelText("Focus node");
      expect(bullet.style.opacity).toBe("1");
    });
  });

  it("focuses a node via bullet click and renders breadcrumbs", async () => {
    render(
      <OutlineProvider>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const primaryRow = await screen.findByText(/Welcome to Thortiq/i);
    const rowElement = primaryRow.closest('[data-outline-row="true"]') as HTMLElement | null;
    expect(rowElement).not.toBeNull();
    const focusButton = within(rowElement as HTMLElement).getByLabelText(
      "Focus node"
    );

    await act(async () => {
      fireEvent.click(focusButton);
    });

    const focusHeading = await screen.findByRole("heading", { level: 2, name: /Welcome to Thortiq/i });
    expect(focusHeading).toBeDefined();

    const breadcrumbNav = screen.getByRole("navigation", { name: /Focused node breadcrumbs/i });
    expect(breadcrumbNav).toBeDefined();
    const homeCrumb = within(breadcrumbNav).getByRole("button", { name: "Home" });
    expect(homeCrumb).toBeDefined();

    const tree = screen.getByRole("tree");
    expect(within(tree).queryByText(/Welcome to Thortiq/i)).toBeNull();

    await act(async () => {
      fireEvent.click(homeCrumb);
    });

    await waitFor(() => {
      expect(screen.queryByRole("heading", { level: 2, name: /Welcome to Thortiq/i })).toBeNull();
    });
    const restoredRow = within(tree).getByText(/Welcome to Thortiq/i);
    expect(restoredRow).toBeDefined();
  });

  it("keeps multiple selected nodes highlighted after indenting and outdenting", async () => {
    ensurePointerEvent();

    render(
      <OutlineProvider>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");

    await act(async () => {
      fireEvent.keyDown(tree, { key: "Enter" });
    });

    await act(async () => {
      fireEvent.keyDown(tree, { key: "Enter" });
    });

    await waitFor(() => {
      const placeholderRows = within(tree)
        .getAllByRole("treeitem")
        .filter((item) => item.querySelector('[data-outline-text-placeholder="true"]'));
      expect(placeholderRows.length).toBeGreaterThanOrEqual(2);
    });

    const locatePlaceholderRows = () =>
      within(tree)
        .getAllByRole("treeitem")
        .filter((item) => item.querySelector('[data-outline-text-placeholder="true"]'));

    const placeholderRows = locatePlaceholderRows();
    const firstUntitled = placeholderRows[placeholderRows.length - 2];
    const secondUntitled = placeholderRows[placeholderRows.length - 1];

    const originalElementFromPoint = document.elementFromPoint;
    let currentElement: Element | null = null;
    document.elementFromPoint = (x: number, y: number) =>
      currentElement ?? originalElementFromPoint.call(document, x, y);

    try {
      await act(async () => {
        fireEvent.pointerDown(firstUntitled, {
          pointerId: 11,
          button: 0,
          isPrimary: true,
          clientX: 12,
          clientY: 12
        });
      });

      await waitFor(() => {
        expect(firstUntitled.getAttribute("aria-selected")).toBe("true");
      });

      currentElement = secondUntitled;
      await act(async () => {
        window.dispatchEvent(
          new window.PointerEvent("pointermove", {
            pointerId: 11,
            clientX: 24,
            clientY: 72
          })
        );
      });

      await waitFor(() => {
        expect(firstUntitled.getAttribute("aria-selected")).toBe("true");
        expect(secondUntitled.getAttribute("aria-selected")).toBe("true");
      });

      act(() => {
        window.dispatchEvent(new window.PointerEvent("pointerup", { pointerId: 11 }));
      });
    } finally {
      currentElement = null;
      document.elementFromPoint = originalElementFromPoint;
    }

    const firstEdgeId = firstUntitled.getAttribute("data-edge-id");
    const secondEdgeId = secondUntitled.getAttribute("data-edge-id");
    expect(firstEdgeId).toBeTruthy();
    expect(secondEdgeId).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(tree, { key: "Tab" });
    });

    await waitFor(() => {
      const firstAfter = tree.querySelector<HTMLElement>(`[data-edge-id="${firstEdgeId}"]`);
      const secondAfter = tree.querySelector<HTMLElement>(`[data-edge-id="${secondEdgeId}"]`);
      expect(firstAfter).toBeTruthy();
      expect(secondAfter).toBeTruthy();
      expect(firstAfter!.getAttribute("aria-selected")).toBe("true");
      expect(secondAfter!.getAttribute("aria-selected")).toBe("true");
    });

    await act(async () => {
      fireEvent.keyDown(tree, { key: "Tab", shiftKey: true });
    });

    await waitFor(() => {
      const firstAfter = tree.querySelector<HTMLElement>(`[data-edge-id="${firstEdgeId}"]`);
      const secondAfter = tree.querySelector<HTMLElement>(`[data-edge-id="${secondEdgeId}"]`);
      expect(firstAfter).toBeTruthy();
      expect(secondAfter).toBeTruthy();
      expect(firstAfter!.getAttribute("aria-selected")).toBe("true");
      expect(secondAfter!.getAttribute("aria-selected")).toBe("true");
    });
  });

  it("collapses and expands a row via the toggle button", async () => {
    render(
      <OutlineProvider>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    const collapseButton = within(tree).getByRole("button", { name: "Collapse node" });
    fireEvent.click(collapseButton);

    await waitFor(() => {
      expect(within(tree).queryByText(/Phase 1 focuses/i)).toBeNull();
    });

    const expandButton = within(tree).getByRole("button", { name: "Expand node" });
    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(within(tree).getByText(/Phase 1 focuses/i)).toBeTruthy();
    });
  });

  it("renders bullet indicators for parent, collapsed parent, and leaf nodes", async () => {
    render(
      <OutlineProvider>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    const rows = within(tree).getAllByRole("treeitem");
    const rootRow = rows[0];

    const rootBullet = rootRow.querySelector('[data-outline-bullet]') as HTMLElement | null;
    expect(rootBullet?.dataset.outlineBullet).toBe("parent");

    const collapseButton = within(rootRow).getByRole("button", { name: "Collapse node" });
    fireEvent.click(collapseButton);

    await waitFor(() => {
      const collapsedBullet = rootRow.querySelector('[data-outline-bullet]') as HTMLElement | null;
      expect(collapsedBullet?.dataset.outlineBullet).toBe("collapsed-parent");
      expect(collapsedBullet?.style.borderRadius).toBe("9999px");
    });

    const expandButton = within(rootRow).getByRole("button", { name: "Expand node" });
    fireEvent.click(expandButton);

    const leafRow = rows.find((item) => /Phase 1 focuses/i.test(item.textContent ?? ""));
    expect(leafRow).toBeTruthy();
    const leafBullet = leafRow!.querySelector('[data-outline-bullet]') as HTMLElement | null;
    expect(leafBullet?.dataset.outlineBullet).toBe("leaf");

    const togglePlaceholder = leafRow!.querySelector('[data-outline-toggle-placeholder="true"]');
    expect(togglePlaceholder).toBeTruthy();
  });

  it("renders remote presence indicators when awareness targets a row", async () => {
    render(
      <OutlineProvider options={{ enableAwarenessIndicators: true }}>
        <RemotePresence />
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    await waitFor(() => {
      expect(tree.querySelector('[data-outline-presence-indicator="true"]')).toBeTruthy();
    });
    const indicator = tree.querySelector('[data-outline-presence-indicator="true"]') as HTMLElement | null;
    expect(indicator).toBeTruthy();
    expect(indicator?.getAttribute("title")).toContain("Remote User");
  });

  it("ignores keyboard shortcuts that originate from the editor DOM", async () => {
    render(
      <OutlineProvider>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    const rows = within(tree).getAllByRole("treeitem");
    const firstRow = rows[0];

    const fakeEditor = document.createElement("div");
    fakeEditor.className = "thortiq-prosemirror";
    firstRow.appendChild(fakeEditor);

    fireEvent.keyDown(fakeEditor, { key: "ArrowDown", bubbles: true });

    expect(rows[0].getAttribute("aria-selected")).toBe("true");
    expect(rows[1].getAttribute("aria-selected")).toBe("false");

    fakeEditor.remove();
  });

  it("renders outline from persistence when websocket creation fails", async () => {
    const globalWithSocket = globalThis as { WebSocket?: typeof WebSocket };
    const originalWebSocket = globalWithSocket.WebSocket;

    // Simulate browsers throwing during socket construction when offline.
    class ExplodingWebSocket {
      constructor() {
        throw new Error("intentional socket failure");
      }
    }

    globalWithSocket.WebSocket = ExplodingWebSocket as unknown as typeof WebSocket;

    const providerFactory = createWebsocketProviderFactory({ endpoint: "ws://localhost:6123/sync/v1/{docId}" });

    try {
      render(
        <OutlineProvider options={{ providerFactory }}>
          <SyncStatusProbe />
          <OutlineView paneId="outline" />
        </OutlineProvider>
      );

      await screen.findByText(/Welcome to Thortiq/i);

      const statusElement = await screen.findByTestId("sync-status");

      await waitFor(() => {
        expect(statusElement.textContent).toBe("recovering");
      });
    } finally {
      if (originalWebSocket) {
        globalWithSocket.WebSocket = originalWebSocket;
      } else {
        delete globalWithSocket.WebSocket;
      }
    }
  });
});

describe.skip("OutlineView with ProseMirror", () => {
  let originalResizeObserver: typeof ResizeObserver | undefined;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).__THORTIQ_PROSEMIRROR_TEST__ = true;
    (globalThis as Record<string, unknown>).__THORTIQ_OUTLINE_VIRTUAL_FALLBACK__ = true;
    originalResizeObserver = globalThis.ResizeObserver;

    class TestResizeObserver implements ResizeObserver {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(target: Element): void {
        const entry = {
          target,
          contentRect: { width: 960, height: 480 } as DOMRectReadOnly,
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: []
        } as ResizeObserverEntry;
        queueMicrotask(() => this.callback([entry], this));
      }

      unobserve(): void {
        /* noop for tests */
      }

      disconnect(): void {
        /* noop for tests */
      }
    }

    (globalThis as Record<string, unknown>).ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__THORTIQ_PROSEMIRROR_TEST__;
    delete (globalThis as Record<string, unknown>).__THORTIQ_OUTLINE_VIRTUAL_FALLBACK__;
    delete (globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__;
    if (originalResizeObserver) {
      (globalThis as Record<string, unknown>).ResizeObserver = originalResizeObserver;
    } else {
      delete (globalThis as Record<string, unknown>).ResizeObserver;
    }
  });

  const renderWithEditor = () =>
    render(
      <OutlineProvider>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

  const getActiveEditorView = (): EditorView => {
    const editorInstance = (globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__ as
      | { view: EditorView }
      | undefined;
    expect(editorInstance).toBeTruthy();
    return editorInstance!.view;
  };

  const waitForEditorReady = async () => {
    const tree = await screen.findByRole("tree");
    const items = await screen.findAllByRole("treeitem");
    expect(items.length).toBeGreaterThan(0);
    await waitFor(() => expect(document.querySelector(".thortiq-prosemirror")).toBeTruthy());
    return { tree, view: getActiveEditorView() };
  };

  // TODO(thortiq): enable once ProseMirror/y-prosemirror lifecycle is stable across node switches.
  it("keeps static rows in sync with editor edits", async () => {
    renderWithEditor();

    const { tree, view } = await waitForEditorReady();
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    view.dispatch(view.state.tr.insertText(" updated"));

    await waitFor(() => expect(view.state.doc.textContent).toMatch(/updated/));

    fireEvent.keyDown(tree, { key: "ArrowDown" });

    await waitFor(() => expect(tree.textContent).toMatch(/Welcome to Thortiq updated/));
  });

  // TODO(thortiq): fails due to y-prosemirror awareness updates hitting a destroyed view.
  it("toggles collapsed state via keyboard", async () => {
    renderWithEditor();

    const { tree } = await waitForEditorReady();

    // Collapse the root node.
    fireEvent.keyDown(tree, { key: "ArrowLeft" });

    await waitFor(() => expect(within(tree).queryByText(/Phase 1 focuses/i)).toBeNull());
    expect(within(tree).getByText("▶")).toBeTruthy();

    // Expand again.
    fireEvent.keyDown(tree, { key: "ArrowRight" });

    await waitFor(() => expect(within(tree).getByText(/Phase 1 focuses/i)).toBeTruthy());
  });

  it("moves the caret to the line end before advancing with ArrowDown inside the editor", async () => {
    renderWithEditor();

    const { tree, view } = await waitForEditorReady();
    view.dispatch(view.state.tr.setSelection(TextSelection.atStart(view.state.doc)));
    expect(view.state.selection.eq(TextSelection.atStart(view.state.doc))).toBe(true);

    await act(async () => {
      fireEvent.keyDown(view.dom, { key: "ArrowDown" });
    });

    expect(view.state.selection.eq(TextSelection.atEnd(view.state.doc))).toBe(true);

    const selectedBefore = within(tree)
      .getAllByRole("treeitem")
      .find((item) => item.getAttribute("aria-selected") === "true");
    expect(selectedBefore).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(view.dom, { key: "ArrowDown" });
    });

    await waitFor(() => {
      const selectedAfter = within(tree)
        .getAllByRole("treeitem")
        .find((item) => item.getAttribute("aria-selected") === "true");
      expect(selectedAfter).not.toBe(selectedBefore);
      expect(selectedAfter?.textContent).toMatch(/Phase 1 focuses/i);
    });

    await waitFor(() => expect(view.state.doc.textContent).toMatch(/Phase 1 focuses/i));
    expect(view.state.selection.eq(TextSelection.atEnd(view.state.doc))).toBe(true);
  });

  it("moves the caret to the line start before moving up with ArrowUp inside the editor", async () => {
    renderWithEditor();

    const { tree, view } = await waitForEditorReady();

    await act(async () => {
      fireEvent.keyDown(view.dom, { key: "ArrowDown" });
      fireEvent.keyDown(view.dom, { key: "ArrowDown" });
    });

    await waitFor(() => expect(view.state.doc.textContent).toMatch(/Phase 1 focuses/i));
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    expect(view.state.selection.eq(TextSelection.atEnd(view.state.doc))).toBe(true);

    await act(async () => {
      fireEvent.keyDown(view.dom, { key: "ArrowUp" });
    });

    expect(view.state.selection.eq(TextSelection.atStart(view.state.doc))).toBe(true);

    const selectedBefore = within(tree)
      .getAllByRole("treeitem")
      .find((item) => item.getAttribute("aria-selected") === "true");
    expect(selectedBefore?.textContent).toMatch(/Phase 1 focuses/i);

    await act(async () => {
      fireEvent.keyDown(view.dom, { key: "ArrowUp" });
    });

    await waitFor(() => {
      const selectedAfter = within(tree)
        .getAllByRole("treeitem")
        .find((item) => item.getAttribute("aria-selected") === "true");
      expect(selectedAfter?.textContent).toMatch(/Welcome to Thortiq/i);
    });

    await waitFor(() => expect(view.state.doc.textContent).toMatch(/Welcome to Thortiq/i));
    expect(view.state.selection.eq(TextSelection.atStart(view.state.doc))).toBe(true);
  });

  it("indents the selected node when Tab is pressed inside the editor", async () => {
    renderWithEditor();

    const { tree, view } = await waitForEditorReady();

    // Insert a new sibling root so there is something to indent.
    fireEvent.keyDown(tree, { key: "Enter" });

    const getPlaceholderRow = () =>
      within(tree)
        .getAllByRole("treeitem")
        .find((item) => item.querySelector('[data-outline-text-placeholder="true"]')) ?? null;

    await waitFor(() => {
      const row = getPlaceholderRow();
      expect(row).toBeTruthy();
      expect(row!.getAttribute("aria-selected")).toBe("true");
    });

    const placeholderNode = getPlaceholderRow();
    expect(placeholderNode).toBeTruthy();
    const edgeId = placeholderNode!.getAttribute("data-edge-id");
    expect(edgeId).toBeTruthy();

    await waitFor(() => expect(placeholderNode!.querySelector(".thortiq-prosemirror")).toBeTruthy());

    view.focus();
    await act(async () => {
      fireEvent.keyDown(view.dom, { key: "Tab" });
    });

    await waitFor(() => {
      const updatedRow = tree.querySelector<HTMLElement>(`[data-edge-id="${edgeId}"]`);
      expect(updatedRow).toBeTruthy();
      expect(updatedRow!.getAttribute("aria-level")).toBe("2");
      expect(updatedRow!.getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(view.dom);
    });
  });

  it("deletes selected nodes with Ctrl-Shift-Backspace", async () => {
    render(
      <OutlineProvider>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    const initialCount = within(tree).getAllByRole("treeitem").length;

    await act(async () => {
      fireEvent.keyDown(tree, { key: "Enter" });
    });

    await waitFor(() => {
      expect(within(tree).getAllByRole("treeitem").length).toBe(initialCount + 1);
    });

    fireEvent.keyDown(tree, { key: "Backspace", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(within(tree).getAllByRole("treeitem").length).toBe(initialCount);
    });
  });

  it("asks for confirmation before deleting large selections", async () => {
    const seedOutline: NonNullable<OutlineProviderOptions["seedOutline"]> = (sync) => {
      const parent = createNode(sync.outline, { text: "root", origin: sync.localOrigin });
      addEdge(sync.outline, { parentNodeId: null, childNodeId: parent, origin: sync.localOrigin });
      for (let index = 0; index < 31; index += 1) {
        const child = createNode(sync.outline, { text: `child ${index}`, origin: sync.localOrigin });
        addEdge(sync.outline, { parentNodeId: parent, childNodeId: child, origin: sync.localOrigin });
      }
    };

    render(
      <OutlineProvider options={{ skipDefaultSeed: true, seedOutline }}>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    const rows = within(tree).getAllByRole("treeitem");
    expect(rows.length).toBe(32);
    fireEvent.mouseDown(rows[0]);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    fireEvent.keyDown(tree, { key: "Backspace", ctrlKey: true, shiftKey: true });
    expect(confirmSpy).toHaveBeenCalledWith(
      "Delete 32 nodes? This also removes their descendants."
    );
    expect(within(tree).getAllByRole("treeitem").length).toBe(32);

    confirmSpy.mockReturnValue(true);
    fireEvent.keyDown(tree, { key: "Backspace", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(within(tree).queryAllByRole("treeitem").length).toBe(0);
    });

    confirmSpy.mockRestore();
  });

  it("moves a child node to the root level via bullet drag", async () => {
    ensurePointerEvent();

    render(
      <OutlineProvider>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    mockBoundingClientRect(tree, { top: 0, left: 0, right: 640, bottom: 640 });

    const rootText = await screen.findByText(/Welcome to Thortiq/i);
    const rootRow = rootText.closest('[data-outline-row="true"]') as HTMLElement;
    const phaseText = await screen.findByText(/Phase 1 focuses/i);
    const phaseRow = phaseText.closest('[data-outline-row="true"]') as HTMLElement;

    mockBoundingClientRect(rootRow, { top: 8, left: 0, right: 640, bottom: 36 });
    const rootBullet = within(rootRow).getByLabelText("Focus node");
    mockBoundingClientRect(rootBullet, { top: 12, left: 24, right: 44, bottom: 32 });
    const rootTextCell = rootRow.querySelector('[data-outline-text-cell="true"]') as HTMLElement;
    mockBoundingClientRect(rootTextCell, { top: 12, left: 80, right: 620, bottom: 32 });

    mockBoundingClientRect(phaseRow, { top: 50, left: 0, right: 640, bottom: 78 });
    const phaseBullet = within(phaseRow).getByLabelText("Focus node");
    mockBoundingClientRect(phaseBullet, { top: 54, left: 48, right: 68, bottom: 74 });
    const phaseTextCell = phaseRow.querySelector('[data-outline-text-cell="true"]') as HTMLElement;
    mockBoundingClientRect(phaseTextCell, { top: 54, left: 110, right: 620, bottom: 74 });

    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => phaseRow);

    await act(async () => {
      fireEvent.pointerDown(phaseBullet, {
        pointerId: 21,
        button: 0,
        isPrimary: true,
        clientX: 60,
        clientY: 60
      });
    });

    await act(async () => {
      window.dispatchEvent(new window.PointerEvent("pointermove", {
        pointerId: 21,
        clientX: 72,
        clientY: 60
      }));
    });

    await act(async () => {
      window.dispatchEvent(new window.PointerEvent("pointermove", {
        pointerId: 21,
        clientX: 12,
        clientY: 60
      }));
    });

    await act(async () => {
      window.dispatchEvent(new window.PointerEvent("pointerup", {
        pointerId: 21,
        clientX: 12,
        clientY: 60
      }));
  });

  document.elementFromPoint = originalElementFromPoint;

  await waitFor(() => {
      const updatedRows = within(tree).getAllByRole("treeitem");
      const movedRow = updatedRows.find((candidate) =>
        within(candidate).queryByText(/Phase 1 focuses/i)
      );
      expect(movedRow).toBeDefined();
      expect(movedRow!.getAttribute("aria-level")).toBe("1");
    });
  });

  it("drops onto the blue zone to create a child", async () => {
    ensurePointerEvent();

    render(
      <OutlineProvider>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    mockBoundingClientRect(tree, { top: 0, left: 0, right: 640, bottom: 640 });

    const scrollText = await screen.findByText(/Scroll to see TanStack Virtual/i);
    const scrollRow = scrollText.closest('[data-outline-row="true"]') as HTMLElement;
    const structuralText = await screen.findByText(/All text and structural changes flow/i);
    const structuralRow = structuralText.closest('[data-outline-row="true"]') as HTMLElement;

    mockBoundingClientRect(scrollRow, { top: 80, left: 0, right: 640, bottom: 108 });
    const scrollBullet = within(scrollRow).getByLabelText("Focus node");
    mockBoundingClientRect(scrollBullet, { top: 84, left: 48, right: 68, bottom: 104 });
    const scrollTextCell = scrollRow.querySelector('[data-outline-text-cell="true"]') as HTMLElement;
    mockBoundingClientRect(scrollTextCell, { top: 84, left: 120, right: 620, bottom: 104 });

    mockBoundingClientRect(structuralRow, { top: 118, left: 0, right: 640, bottom: 146 });
    const structuralBullet = within(structuralRow).getByLabelText("Focus node");
    mockBoundingClientRect(structuralBullet, { top: 122, left: 48, right: 68, bottom: 142 });
    const structuralTextCell = structuralRow.querySelector('[data-outline-text-cell="true"]') as HTMLElement;
    mockBoundingClientRect(structuralTextCell, { top: 122, left: 120, right: 620, bottom: 142 });

    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn((_, y: number) => (y < 110 ? scrollRow : structuralRow));

    await act(async () => {
      fireEvent.pointerDown(structuralBullet, {
        pointerId: 31,
        button: 0,
        isPrimary: true,
        clientX: 132,
        clientY: 132
      });
    });

    await act(async () => {
      window.dispatchEvent(new window.PointerEvent("pointermove", {
        pointerId: 31,
        clientX: 140,
        clientY: 132
      }));
    });

    await act(async () => {
      window.dispatchEvent(new window.PointerEvent("pointermove", {
        pointerId: 31,
        clientX: 160,
        clientY: 96
      }));
    });

    await act(async () => {
      window.dispatchEvent(new window.PointerEvent("pointerup", {
        pointerId: 31,
        clientX: 160,
        clientY: 96
      }));
    });

    document.elementFromPoint = originalElementFromPoint;

    await waitFor(() => {
      const updatedRows = within(tree).getAllByRole("treeitem");
      const movedRow = updatedRows.find((candidate) =>
        within(candidate).queryByText(/All text and structural changes flow/i)
      );
      expect(movedRow).toBeDefined();
      expect(movedRow!.getAttribute("aria-level")).toBe("3");
    });
  });

  it("keeps multi-selection active when opening the context menu on a selected row", async () => {
    let capturedSessionStore: SessionStore | null = null;
    const handleSessionStoreCapture = (store: SessionStore) => {
      capturedSessionStore = store;
    };

    render(
      <OutlineProvider>
        <SessionStoreCapture onReady={handleSessionStoreCapture} />
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    await waitFor(() => expect(capturedSessionStore).not.toBeNull());
    const paneId = "outline";

    const initialRows = within(tree).getAllByRole("treeitem");
    expect(initialRows.length).toBeGreaterThan(2);
    const firstEdgeId = initialRows[0].getAttribute("data-edge-id") as EdgeId;
    const secondEdgeId = initialRows[1].getAttribute("data-edge-id") as EdgeId;

    await act(async () => {
      capturedSessionStore!.update((state) => {
        const panes = state.panes.map((pane) =>
          pane.paneId === paneId
            ? {
                ...pane,
                activeEdgeId: secondEdgeId,
                selectionRange: { anchorEdgeId: firstEdgeId, headEdgeId: secondEdgeId }
              }
            : pane
        );
        return {
          ...state,
          panes,
          selectedEdgeId: secondEdgeId
        };
      });
    });

    await waitFor(() => {
      const rows = within(tree).getAllByRole("treeitem");
      expect(rows[0].getAttribute("aria-selected")).toBe("true");
      expect(rows[1].getAttribute("aria-selected")).toBe("true");
    });

    const targetRow = within(tree).getAllByRole("treeitem")[1];
    fireEvent.contextMenu(targetRow, { clientX: 24, clientY: 24 });

    await screen.findByRole("menu");

    const rowsAfterContext = within(tree).getAllByRole("treeitem");
    expect(rowsAfterContext[0].getAttribute("aria-selected")).toBe("true");
    expect(rowsAfterContext[1].getAttribute("aria-selected")).toBe("true");

    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("collapses multi-selection when opening the context menu on an unselected row", async () => {
    let capturedSessionStore: SessionStore | null = null;
    const handleSessionStoreCapture = (store: SessionStore) => {
      capturedSessionStore = store;
    };

    render(
      <OutlineProvider>
        <SessionStoreCapture onReady={handleSessionStoreCapture} />
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    await waitFor(() => expect(capturedSessionStore).not.toBeNull());
    const paneId = "outline";

    const initialRows = within(tree).getAllByRole("treeitem");
    expect(initialRows.length).toBeGreaterThan(3);
    const firstEdgeId = initialRows[0].getAttribute("data-edge-id") as EdgeId;
    const secondEdgeId = initialRows[1].getAttribute("data-edge-id") as EdgeId;
    const thirdEdgeId = initialRows[2].getAttribute("data-edge-id") as EdgeId;

    await act(async () => {
      capturedSessionStore!.update((state) => {
        const panes = state.panes.map((pane) =>
          pane.paneId === paneId
            ? {
                ...pane,
                activeEdgeId: secondEdgeId,
                selectionRange: { anchorEdgeId: firstEdgeId, headEdgeId: secondEdgeId }
              }
            : pane
        );
        return {
          ...state,
          panes,
          selectedEdgeId: secondEdgeId
        };
      });
    });

    await waitFor(() => {
      const rows = within(tree).getAllByRole("treeitem");
      expect(rows[0].getAttribute("aria-selected")).toBe("true");
      expect(rows[1].getAttribute("aria-selected")).toBe("true");
    });

    const thirdRow = within(tree).getAllByRole("treeitem")[2];
    fireEvent.contextMenu(thirdRow, { clientX: 32, clientY: 32 });

    await screen.findByRole("menu");

    await waitFor(() => {
      const rows = within(tree).getAllByRole("treeitem");
      expect(rows[0].getAttribute("aria-selected")).toBe("false");
      expect(rows[1].getAttribute("aria-selected")).toBe("false");
      expect(rows[2].getAttribute("aria-selected")).toBe("true");
      expect(rows[2].getAttribute("data-edge-id")).toBe(thirdEdgeId);
    });

    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("prompts before reassigning the inbox via the context menu", async () => {
    render(
      <OutlineProvider>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    const rows = within(tree).getAllByRole("treeitem");
    expect(rows.length).toBeGreaterThan(1);

    fireEvent.contextMenu(rows[0], { clientX: 20, clientY: 20 });
    const firstTurnInto = await screen.findByRole("menuitem", { name: "Turn Into" });
    fireEvent.click(firstTurnInto);
    const firstInbox = await screen.findByRole("menuitem", { name: "Inbox" });
    fireEvent.click(firstInbox);

    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "Inbox" })).toBeNull();
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.contextMenu(rows[1], { clientX: 28, clientY: 28 });
    const secondTurnInto = await screen.findByRole("menuitem", { name: "Turn Into" });
    fireEvent.click(secondTurnInto);
    const secondInbox = await screen.findByRole("menuitem", { name: "Inbox" });
    fireEvent.click(secondInbox);

    expect(confirmSpy).toHaveBeenCalled();
    const [message] = confirmSpy.mock.calls[0] ?? ["" ];
    expect(message).toContain("Change the Inbox?");
    confirmSpy.mockRestore();
  });

  it("moves a node to the root using the Move to dialog", async () => {
    const seedOutline: NonNullable<OutlineProviderOptions["seedOutline"]> = (sync) => {
      const parent = createNode(sync.outline, { text: "Project", origin: sync.localOrigin });
      addEdge(sync.outline, { parentNodeId: null, childNodeId: parent, origin: sync.localOrigin });
      const child = createNode(sync.outline, { text: "Task", origin: sync.localOrigin });
      addEdge(sync.outline, { parentNodeId: parent, childNodeId: child, origin: sync.localOrigin });
      const sibling = createNode(sync.outline, { text: "Notes", origin: sync.localOrigin });
      addEdge(sync.outline, { parentNodeId: null, childNodeId: sibling, origin: sync.localOrigin });
    };

    render(
      <OutlineProvider options={{ seedOutline }}>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    const taskRow = within(tree).getByText("Task").closest('[data-outline-row="true"]') as HTMLElement;
    expect(taskRow).toBeTruthy();
    expect(taskRow.getAttribute("aria-level")).toBe("2");

    fireEvent.contextMenu(taskRow, { clientX: 32, clientY: 32 });
    const moveCommand = await screen.findByRole("menuitem", { name: "Move to…" });
    fireEvent.click(moveCommand);

    await screen.findByLabelText("Move selection search query");
    const rootOption = await screen.findByRole("option", { name: "Root" });
    fireEvent.click(rootOption);

    await waitFor(() => {
      const updatedTaskRow = within(tree).getByText("Task").closest('[data-outline-row="true"]') as HTMLElement;
      expect(updatedTaskRow.getAttribute("aria-level")).toBe("1");
    });
    expect(screen.queryByLabelText("Move selection search query")).toBeNull();
  });

});
