import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { useEffect, useRef } from "react";
import * as Y from "yjs";

import {
  OutlineProvider,
  useOutlineSnapshot,
  useSyncContext,
  useOutlinePaneState,
  useOutlineSessionStore
} from "../OutlineProvider";
import { OutlineView } from "../OutlineView";
import {
  addEdge,
  createMirrorEdge,
  createNode,
  createOutlineSnapshot,
  getNodeTextFragment,
  removeEdge,
  setNodeText,
  withTransaction,
  type EdgeId,
  type NodeId,
  type OutlineSnapshot
} from "@thortiq/client-core";
import type {
  SessionPaneSearchState,
  SessionPaneState,
  SessionStorageAdapter
} from "@thortiq/sync-core";

interface FixtureHandles {
  searchNodeId?: NodeId;
  searchEdgeId?: EdgeId;
  wikiSourceNodeId?: NodeId;
  wikiSourceEdgeId?: EdgeId;
  wikiTargetNodeId?: NodeId;
  wikiTargetEdgeId?: EdgeId;
  mirrorTargetNodeId?: NodeId;
  mirrorTargetEdgeId?: EdgeId;
  tagNodeId?: NodeId;
  tagEdgeId?: EdgeId;
}

interface OutlineReadyPayload {
  readonly snapshot: OutlineSnapshot;
  readonly sync: ReturnType<typeof useSyncContext>;
}

const OutlineReady = ({ onReady }: { readonly onReady: (payload: OutlineReadyPayload) => void }) => {
  const snapshot = useOutlineSnapshot();
  const sync = useSyncContext();
  const reportedRef = useRef(false);

  useEffect(() => {
    if (reportedRef.current) {
      return;
    }
    console.log("OutlineReady root edges", snapshot.rootEdgeIds.length);
    if (snapshot.rootEdgeIds.length === 0) {
      return;
    }
    reportedRef.current = true;
    onReady({ snapshot, sync });
  }, [onReady, snapshot, sync]);

  return null;
};

const createMemorySessionAdapter = (): SessionStorageAdapter => {
  let value: string | null = null;
  const listeners = new Set<() => void>();
  return {
    read: () => value,
    write: (next) => {
      value = next;
      listeners.forEach((listener) => listener());
    },
    clear: () => {
      value = null;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
};

const SearchStateProbe = ({ onUpdate }: { readonly onUpdate: (state: SessionPaneSearchState) => void }) => {
  const pane = useOutlinePaneState("outline");
  useEffect(() => {
    if (pane?.search) {
      onUpdate(pane.search);
    }
  }, [pane, onUpdate]);
  return null;
};

const SessionFocusProbe = ({
  paneId,
  onUpdate
}: {
  readonly paneId: string;
  readonly onUpdate: (pane: SessionPaneState | null) => void;
}) => {
  const sessionStore = useOutlineSessionStore();
  useEffect(() => {
    const read = () => {
      const state = sessionStore.getState();
      const pane = state.panes.find((candidate) => candidate.paneId === paneId) ?? null;
      onUpdate(pane);
    };
    read();
    return sessionStore.subscribe(read);
  }, [onUpdate, paneId, sessionStore]);
  return null;
};

const openSearchInput = async (): Promise<HTMLInputElement> => {
  const toggle = screen.getByRole("button", { name: "Search outline" });
  fireEvent.click(toggle);
  return await screen.findByRole("textbox", { name: "Search outline" });
};

const submitSearchQuery = async (
  value: string
): Promise<{ input: HTMLInputElement; form: HTMLFormElement }> => {
  const input = await openSearchInput();
  fireEvent.change(input, { target: { value } });
  const form = input.closest("form");
  if (!form) {
    throw new Error("Search form not found");
  }
  fireEvent.submit(form);
  return { input, form };
};

const ensureSearchFixtures = async (ready: OutlineReadyPayload, handles: FixtureHandles): Promise<void> => {
  if (handles.searchNodeId) {
    return;
  }
  const { snapshot, sync } = ready;
  const rootEdgeId = snapshot.rootEdgeIds[0];
  if (!rootEdgeId) {
    throw new Error("Seed outline is missing a root edge");
  }
  const rootEdge = snapshot.edges.get(rootEdgeId);
  if (!rootEdge) {
    throw new Error("Root edge snapshot not found");
  }
  const rootNodeId = rootEdge.childNodeId;
  await act(async () => {
    const searchNodeId = createNode(sync.outline, { text: "Search target note", origin: sync.localOrigin });
    const searchEdge = addEdge(sync.outline, { parentNodeId: rootNodeId, childNodeId: searchNodeId, origin: sync.localOrigin });

    const siblingNodeId = createNode(sync.outline, { text: "Secondary note", origin: sync.localOrigin });
    addEdge(sync.outline, { parentNodeId: rootNodeId, childNodeId: siblingNodeId, origin: sync.localOrigin });

    const wikiTargetNodeId = createNode(sync.outline, { text: "Destination topic", origin: sync.localOrigin });
    const wikiTargetEdge = addEdge(sync.outline, {
      parentNodeId: rootNodeId,
      childNodeId: wikiTargetNodeId,
      origin: sync.localOrigin
    });

    const wikiSourceNodeId = createNode(sync.outline);
    const fragment = getNodeTextFragment(sync.outline, wikiSourceNodeId);
    withTransaction(sync.outline, () => {
      fragment.delete(0, fragment.length);
      const paragraph = new Y.XmlElement("paragraph");
      const textNode = new Y.XmlText();
      textNode.insert(0, "Destination topic", { wikilink: { nodeId: wikiTargetNodeId } });
      paragraph.insert(0, [textNode]);
      fragment.insert(0, [paragraph]);
    });
    const wikiSourceEdge = addEdge(sync.outline, { parentNodeId: rootNodeId, childNodeId: wikiSourceNodeId, origin: sync.localOrigin });

    handles.searchNodeId = searchNodeId;
    handles.searchEdgeId = searchEdge.edgeId;
    handles.wikiSourceNodeId = wikiSourceNodeId;
    handles.wikiSourceEdgeId = wikiSourceEdge.edgeId;
    handles.wikiTargetNodeId = wikiTargetNodeId;
    handles.wikiTargetEdgeId = wikiTargetEdge.edgeId;
  });
};

const ensureMirrorWikiFixtures = async (ready: OutlineReadyPayload, handles: FixtureHandles): Promise<void> => {
  if (handles.mirrorTargetNodeId) {
    return;
  }
  const { snapshot, sync } = ready;
  const rootEdgeId = snapshot.rootEdgeIds[0];
  if (!rootEdgeId) {
    throw new Error("Seed outline is missing a root edge");
  }
  const rootEdge = snapshot.edges.get(rootEdgeId);
  if (!rootEdge) {
    throw new Error("Root edge snapshot not found");
  }
  const rootNodeId = rootEdge.childNodeId;

  await act(async () => {
    const branchNodeId = createNode(sync.outline, { text: "Mirror branch", origin: sync.localOrigin });
    const branchEdge = addEdge(sync.outline, {
      parentNodeId: rootNodeId,
      childNodeId: branchNodeId,
      origin: sync.localOrigin
    });

    const targetNodeId = createNode(sync.outline, { text: "Mirror target", origin: sync.localOrigin });
    const targetEdge = addEdge(sync.outline, {
      parentNodeId: branchNodeId,
      childNodeId: targetNodeId,
      origin: sync.localOrigin
    });

    const mirrorResult = createMirrorEdge({
      outline: sync.outline,
      mirrorNodeId: branchNodeId,
      insertParentNodeId: rootNodeId,
      insertIndex: 1,
      origin: sync.localOrigin
    });
    if (!mirrorResult) {
      throw new Error("Failed to create mirror edge");
    }

    removeEdge(sync.outline, branchEdge.edgeId, {
      removeChildNodeIfOrphaned: false,
      origin: sync.localOrigin
    });

    const sourceNodeId = createNode(sync.outline, { origin: sync.localOrigin });
    const fragment = getNodeTextFragment(sync.outline, sourceNodeId);
    withTransaction(sync.outline, () => {
      fragment.delete(0, fragment.length);
      const paragraph = new Y.XmlElement("paragraph");
      const textNode = new Y.XmlText();
      textNode.insert(0, "Mirror target", { wikilink: { nodeId: targetNodeId } });
      paragraph.insert(0, [textNode]);
      fragment.insert(0, [paragraph]);
    }, sync.localOrigin);

    addEdge(sync.outline, { parentNodeId: rootNodeId, childNodeId: sourceNodeId, origin: sync.localOrigin });

    handles.wikiSourceNodeId = sourceNodeId;
    handles.mirrorTargetNodeId = targetNodeId;
    handles.mirrorTargetEdgeId = targetEdge.edgeId;
  });
};

const ensureTagFixtures = async (ready: OutlineReadyPayload, handles: FixtureHandles): Promise<void> => {
  if (handles.tagNodeId) {
    return;
  }
  const { snapshot, sync } = ready;
  const rootEdgeId = snapshot.rootEdgeIds[0];
  if (!rootEdgeId) {
    throw new Error("Seed outline is missing a root edge");
  }
  const rootEdge = snapshot.edges.get(rootEdgeId);
  if (!rootEdge) {
    throw new Error("Root edge snapshot not found");
  }
  const rootNodeId = rootEdge.childNodeId;

  await act(async () => {
    const tagNodeId = createNode(sync.outline, { origin: sync.localOrigin });
    const fragment = getNodeTextFragment(sync.outline, tagNodeId);
    withTransaction(sync.outline, () => {
      fragment.delete(0, fragment.length);
      const paragraph = new Y.XmlElement("paragraph");
      const textNode = new Y.XmlText();
      textNode.insert(0, "#alpha", { tag: { id: "alpha", trigger: "#", label: "alpha" } });
      paragraph.insert(0, [textNode]);
      fragment.insert(0, [paragraph]);
    }, sync.localOrigin);

    const tagEdge = addEdge(sync.outline, {
      parentNodeId: rootNodeId,
      childNodeId: tagNodeId,
      origin: sync.localOrigin
    });

    handles.tagNodeId = tagNodeId;
    handles.tagEdgeId = tagEdge.edgeId;
  });
};

afterEach(() => {
  cleanup();
  const globals = globalThis as Record<string, unknown>;
  delete globals.__THORTIQ_OUTLINE_VIRTUAL_FALLBACK__;
  delete globals.__THORTIQ_PROSEMIRROR_TEST__;
});

describe("OutlineView search flows", () => {
  it("focuses target edge when activating a wikilink", async () => {
    const handles: FixtureHandles = {};
    let readyState: OutlineReadyPayload | null = null;
    const sessionAdapter = createMemorySessionAdapter();
    const paneRef: { current: SessionPaneState | null } = { current: null };

    render(
      <OutlineProvider options={{ sessionAdapter }}>
        <OutlineReady onReady={(payload) => {
          readyState = payload;
        }}
        />
        <SessionFocusProbe paneId="outline" onUpdate={(pane) => {
          paneRef.current = pane;
        }}
        />
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    await waitFor(() => {
      expect(readyState).not.toBeNull();
    });
    await screen.findAllByRole("treeitem");
    await ensureSearchFixtures(readyState!, handles);
    await waitFor(() => {
      expect(tree.querySelector('[data-outline-wikilink="true"]')).toBeTruthy();
    });
    if (!handles.wikiTargetEdgeId || !handles.wikiTargetNodeId) {
      throw new Error("Wiki link fixtures were not initialised");
    }
    const wikiButton = tree.querySelector<HTMLButtonElement>('[data-outline-wikilink="true"]');
    expect(wikiButton).not.toBeNull();

    expect(paneRef.current?.rootEdgeId ?? null).toBeNull();

    await act(async () => {
      fireEvent.click(wikiButton!);
    });

    await waitFor(() => {
      expect(paneRef.current?.rootEdgeId).toBe(handles.wikiTargetEdgeId);
    });

    const snapshotAfter = createOutlineSnapshot(readyState!.sync.outline);
    const focusedEdge = paneRef.current?.rootEdgeId
      ? snapshotAfter.edges.get(paneRef.current.rootEdgeId)
      : null;
    expect(focusedEdge?.childNodeId).toBe(handles.wikiTargetNodeId);
  });

  it("navigates to a mirror-only placement when activating a wikilink", async () => {
    const handles: FixtureHandles = {};
    let readyState: OutlineReadyPayload | null = null;
    const sessionAdapter = createMemorySessionAdapter();
    const paneRef: { current: SessionPaneState | null } = { current: null };

    render(
      <OutlineProvider options={{ sessionAdapter }}>
        <OutlineReady onReady={(payload) => {
          readyState = payload;
        }}
        />
        <SessionFocusProbe paneId="outline" onUpdate={(pane) => {
          paneRef.current = pane;
        }}
        />
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    await waitFor(() => {
      expect(readyState).not.toBeNull();
    });
    await screen.findAllByRole("treeitem");
    await ensureMirrorWikiFixtures(readyState!, handles);
    await waitFor(() => {
      expect(tree.querySelector('[data-outline-wikilink="true"]')).toBeTruthy();
    });
    if (!handles.mirrorTargetNodeId) {
      throw new Error("Mirror wiki fixtures were not initialised");
    }
    const wikiButton = tree.querySelector<HTMLButtonElement>('[data-outline-wikilink="true"]');
    expect(wikiButton).not.toBeNull();

    await act(async () => {
      fireEvent.click(wikiButton!);
    });

    await waitFor(() => {
      expect(paneRef.current?.rootEdgeId).toBeDefined();
      const currentSnapshot = createOutlineSnapshot(readyState!.sync.outline);
      const rootEdgeId = paneRef.current?.rootEdgeId;
      expect(rootEdgeId).toBeDefined();
      const focusedEdge = rootEdgeId ? currentSnapshot.edges.get(rootEdgeId) : null;
      expect(focusedEdge?.childNodeId).toBe(handles.mirrorTargetNodeId);
    });
  });

  it("clears active search when navigating via wiki link", async () => {
    const handles: FixtureHandles = {};
    let readyState: OutlineReadyPayload | null = null;
    const sessionAdapter = createMemorySessionAdapter();
    let latestSearch: SessionPaneSearchState | null = null;

    render(
      <OutlineProvider options={{ sessionAdapter }}>
        <OutlineReady onReady={(payload) => { readyState = payload; }} />
        <SearchStateProbe onUpdate={(state) => { latestSearch = state; }} />
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    await waitFor(() => {
      expect(readyState).not.toBeNull();
    });
    await screen.findAllByRole("treeitem");
    await ensureSearchFixtures(readyState!, handles);
    await waitFor(() => {
      expect(within(tree).queryAllByText("Destination topic").length).toBeGreaterThan(0);
    });

    await submitSearchQuery("destination");

    await waitFor(() => {
      expect(latestSearch?.submitted).toBe("destination");
      expect((latestSearch?.resultEdgeIds ?? []).length).toBeGreaterThan(0);
    });
    const destinationSearch = latestSearch!;

    await waitFor(() => {
      expect(tree.querySelector('[data-outline-wikilink="true"]')).toBeTruthy();
    });
    const wikiButton = tree.querySelector<HTMLButtonElement>('[data-outline-wikilink="true"]');
    expect(wikiButton).not.toBeNull();

    await act(async () => {
      fireEvent.click(wikiButton!);
    });

    await waitFor(() => {
      const current = latestSearch ?? destinationSearch;
      expect(current.submitted).toBeNull();
      expect(current.isInputVisible).toBe(false);
    });
  });

  it("toggles tag filters when clicking inline tag pills", async () => {
    const handles: FixtureHandles = {};
    let readyState: OutlineReadyPayload | null = null;
    const sessionAdapter = createMemorySessionAdapter();
    let latestSearch: SessionPaneSearchState | null = null;

    render(
      <OutlineProvider options={{ sessionAdapter }}>
        <OutlineReady onReady={(payload) => { readyState = payload; }} />
        <SearchStateProbe onUpdate={(state) => { latestSearch = state; }} />
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    await waitFor(() => {
      expect(readyState).not.toBeNull();
    });
    await screen.findAllByRole("treeitem");
    await ensureTagFixtures(readyState!, handles);
    await waitFor(() => {
      expect(tree.querySelector('[data-outline-tag="true"]')).toBeTruthy();
    });

    if (!handles.tagEdgeId) {
      throw new Error("Tag fixtures were not initialised");
    }

    const tagButton = await screen.findByRole("button", { name: "#alpha" });

    await act(async () => {
      fireEvent.click(tagButton);
    });

    const searchInput = await screen.findByRole("textbox", { name: "Search outline" }) as HTMLInputElement;
    expect(searchInput.value).toBe("tag:alpha");

    await waitFor(() => {
      expect(latestSearch?.submitted).toBe("tag:alpha");
      expect(latestSearch?.resultEdgeIds ?? []).toContain(handles.tagEdgeId);
    });

    await act(async () => {
      fireEvent.click(tagButton);
    });

    await waitFor(() => {
      expect(latestSearch?.draft ?? "").toBe("");
      expect(latestSearch?.submitted).toBeNull();
      expect(latestSearch?.resultEdgeIds ?? []).toHaveLength(0);
    });
  });

  it("applies search automatically after typing pause", async () => {
    const handles: FixtureHandles = {};
    let readyState: OutlineReadyPayload | null = null;
    const sessionAdapter = createMemorySessionAdapter();
    let latestSearch: SessionPaneSearchState | null = null;

    render(
      <OutlineProvider options={{ sessionAdapter }}>
        <OutlineReady onReady={(payload) => { readyState = payload; }} />
        <SearchStateProbe onUpdate={(state) => { latestSearch = state; }} />
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    await waitFor(() => {
      expect(readyState).not.toBeNull();
    });
    await screen.findAllByRole("treeitem");
    await ensureSearchFixtures(readyState!, handles);
    await waitFor(() => {
      expect(within(tree).queryAllByText("Destination topic").length).toBeGreaterThan(0);
    });

    const input = await openSearchInput();
    await act(async () => {
      fireEvent.change(input, { target: { value: "destination" } });
    });

    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 1100);
      });
    });

    await waitFor(() => {
      expect(latestSearch?.submitted).toBe("destination");
      expect((latestSearch?.resultEdgeIds ?? []).length).toBeGreaterThan(0);
    });
  });

  it("keeps search results after edits until the query is resubmitted", async () => {
    const handles: FixtureHandles = {};
    let readyState: OutlineReadyPayload | null = null;
    const sessionAdapter = createMemorySessionAdapter();
    let latestSearch: SessionPaneSearchState | null = null;

    render(
      <OutlineProvider options={{ sessionAdapter }}>
        <OutlineReady onReady={(payload) => { readyState = payload; }} />
        <SearchStateProbe onUpdate={(state) => { latestSearch = state; }} />
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    await waitFor(() => {
      expect(readyState).not.toBeNull();
    });
    await screen.findAllByRole("treeitem");
    await ensureSearchFixtures(readyState!, handles);
    await waitFor(() => {
      expect(within(tree).queryAllByText("Destination topic").length).toBeGreaterThan(0);
    });

    const { input, form } = await submitSearchQuery("target");

    await waitFor(() => {
      expect(latestSearch?.submitted).toBe("target");
      expect((latestSearch?.resultEdgeIds ?? []).length).toBeGreaterThan(0);
    });
    const baselineSearch = latestSearch!;
    const initialResults = new Set(baselineSearch.resultEdgeIds ?? []);

    await waitFor(() => {
      expect(within(tree).queryAllByText("Search target note").length).toBeGreaterThan(0);
    });

    await act(async () => {
      setNodeText(readyState!.sync.outline, handles.searchNodeId!, "Renamed note");
    });

    await waitFor(() => {
      expect(within(tree).queryAllByText("Renamed note").length).toBeGreaterThan(0);
    });
    expect(new Set((latestSearch ?? baselineSearch).resultEdgeIds ?? [])).toEqual(initialResults);

    fireEvent.submit(form);

    await waitFor(() => {
      expect(new Set((latestSearch ?? baselineSearch).resultEdgeIds ?? [])).not.toEqual(initialResults);
    });
    expect(screen.getByRole("textbox", { name: "Search outline" })).toBe(input);

    const clearButton = screen.getByLabelText("Clear search");
    fireEvent.click(clearButton);
    fireEvent.click(clearButton);
    await waitFor(() => {
      expect(latestSearch?.submitted).toBeNull();
      expect(latestSearch?.isInputVisible).toBe(false);
    });
  });
});
