import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

    fireEvent.keyDown(tree, { key: "Enter" });

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

  it("collapses and expands a row via the toggle button", async () => {
    render(
      <OutlineProvider>
        <OutlineView />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    const collapseButton = within(tree).getByRole("button", { name: "Collapse node" });
    fireEvent.click(collapseButton);

    expect(within(tree).queryByText(/Phase 1 focuses/i)).toBeNull();

    const expandButton = within(tree).getByRole("button", { name: "Expand node" });
    fireEvent.click(expandButton);

    expect(within(tree).getByText(/Phase 1 focuses/i)).toBeTruthy();
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
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__THORTIQ_PROSEMIRROR_TEST__ = true;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__THORTIQ_PROSEMIRROR_TEST__;
    delete (globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__;
  });

  const renderWithEditor = () =>
    render(
      <OutlineProvider>
        <OutlineView />
      </OutlineProvider>
    );

  // TODO(thortiq): enable once ProseMirror/y-prosemirror lifecycle is stable across node switches.
  it("keeps static rows in sync with editor edits", async () => {
    renderWithEditor();

    const tree = await screen.findByRole("tree");
    await waitFor(() => expect(document.querySelector(".thortiq-prosemirror")).toBeTruthy());

    const editorInstance = (globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__ as
      | { view: EditorView }
      | undefined;
    expect(editorInstance).toBeTruthy();

    const view = editorInstance!.view;
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    view.dispatch(view.state.tr.insertText(" updated"));

    await waitFor(() => expect(view.state.doc.textContent).toMatch(/updated/));

    fireEvent.keyDown(tree, { key: "ArrowDown" });

    await waitFor(() => expect(tree.textContent).toMatch(/Welcome to Thortiq updated/));
  });

  // TODO(thortiq): fails due to y-prosemirror awareness updates hitting a destroyed view.
  it("toggles collapsed state via keyboard", async () => {
    renderWithEditor();

    const tree = await screen.findByRole("tree");
    await waitFor(() => expect(document.querySelector(".thortiq-prosemirror")).toBeTruthy());

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

    const tree = await screen.findByRole("tree");
    await waitFor(() => expect(document.querySelector(".thortiq-prosemirror")).toBeTruthy());

    const editorInstance = (globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__ as
      | { view: EditorView }
      | undefined;
    expect(editorInstance).toBeTruthy();

    const view = editorInstance!.view;
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

});
