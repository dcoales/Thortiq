import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react-dom/test-utils";

import {
  OutlineProvider,
  useOutlineSnapshot,
  useSyncContext,
  useSyncStatus
} from "./OutlineProvider";
import { OutlineView } from "./OutlineView";
import { createWebsocketProviderFactory } from "./websocketProvider";
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { SyncAwarenessState } from "@thortiq/client-core";

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
        <OutlineView />
      </OutlineProvider>
    );

    const welcome = await screen.findByText(/Welcome to Thortiq/i);
    expect(welcome.textContent).toContain("Welcome to Thortiq");
  });

  it("runs basic outline commands via keyboard", async () => {
    render(
      <OutlineProvider>
        <OutlineView />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    const initialItems = within(tree).getAllByRole("treeitem");
    expect(initialItems.length).toBeGreaterThanOrEqual(4);

    await act(async () => {
      fireEvent.keyDown(tree, { key: "Enter" });
    });

    await screen.findAllByText(/Untitled node/i);
    const afterInsertItems = within(tree).getAllByRole("treeitem");
    expect(afterInsertItems.length).toBe(initialItems.length + 1);

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "Tab" });

    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    fireEvent.keyDown(tree, { key: "ArrowRight" });

    fireEvent.keyDown(tree, { key: "Enter", shiftKey: true });

    const untitledNodes = within(tree).getAllByText(/Untitled node/i);
    expect(untitledNodes.length).toBeGreaterThan(0);
  });

  it("allows clicking a row to select it", async () => {
    render(
      <OutlineProvider>
        <OutlineView />
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
        <OutlineView />
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

  it("keeps multiple selected nodes highlighted after indenting and outdenting", async () => {
    ensurePointerEvent();

    render(
      <OutlineProvider>
        <OutlineView />
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
      const untitledRows = within(tree)
        .getAllByRole("treeitem")
        .filter((item) => item.textContent?.includes("Untitled node"));
      expect(untitledRows.length).toBeGreaterThanOrEqual(2);
    });

    const locateUntitledRows = () =>
      within(tree)
        .getAllByRole("treeitem")
        .filter((item) => item.textContent?.includes("Untitled node"));

    const untitledRows = locateUntitledRows();
    const firstUntitled = untitledRows[untitledRows.length - 2];
    const secondUntitled = untitledRows[untitledRows.length - 1];

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
        <OutlineView />
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
        <OutlineView />
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
        <OutlineView />
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
        <OutlineView />
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
          <OutlineView />
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
        <OutlineView />
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

  it("does not hijack arrow keys inside the editor", async () => {
    renderWithEditor();

    const { tree, view } = await waitForEditorReady();
    const selectedBefore = within(tree)
      .getAllByRole("treeitem")
      .find((item) => item.getAttribute("aria-selected") === "true");
    expect(selectedBefore).toBeTruthy();

    fireEvent.keyDown(view.dom, { key: "ArrowDown" });

    const selectedAfter = within(tree)
      .getAllByRole("treeitem")
      .find((item) => item.getAttribute("aria-selected") === "true");
    expect(selectedAfter).toBe(selectedBefore);
  });

  it("indents the selected node when Tab is pressed inside the editor", async () => {
    renderWithEditor();

    const { tree, view } = await waitForEditorReady();

    // Insert a new sibling root so there is something to indent.
    fireEvent.keyDown(tree, { key: "Enter" });

    const getUntitledRow = () =>
      within(tree)
        .getAllByRole("treeitem")
        .find((item) => item.textContent?.includes("Untitled node")) ?? null;

    await waitFor(() => {
      const row = getUntitledRow();
      expect(row).toBeTruthy();
      expect(row!.getAttribute("aria-selected")).toBe("true");
    });

    const untitledNode = getUntitledRow();
    expect(untitledNode).toBeTruthy();
    const edgeId = untitledNode!.getAttribute("data-edge-id");
    expect(edgeId).toBeTruthy();

    await waitFor(() => expect(untitledNode!.querySelector(".thortiq-prosemirror")).toBeTruthy());

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

});
