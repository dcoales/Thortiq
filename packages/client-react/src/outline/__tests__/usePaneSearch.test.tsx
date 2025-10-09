import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { addEdge, createNode, type EdgeId, type NodeId } from "@thortiq/client-core";
import {
  createEphemeralPersistenceFactory
} from "@thortiq/client-core/sync/persistence";
import { createEphemeralProviderFactory } from "@thortiq/client-core/sync/ephemeralProvider";
import { createMemorySessionStorageAdapter } from "@thortiq/sync-core";

import { OutlineProvider, useOutlineStore } from "../OutlineProvider";
import { usePaneSearch, type PaneSearchSubmitResult } from "../usePaneSearch";

const createTestWrapper = () => {
  const options = {
    persistenceFactory: createEphemeralPersistenceFactory(),
    providerFactory: createEphemeralProviderFactory(),
    sessionAdapter: createMemorySessionStorageAdapter(),
    autoConnect: false,
    skipDefaultSeed: true
  } as const;

  const Wrapper: React.FC<React.PropsWithChildren> = ({ children }) => (
    <OutlineProvider options={options}>{children}</OutlineProvider>
  );

  return { Wrapper };
};

const flushMicrotasks = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("usePaneSearch", () => {
  it("updates draft input and runs parsed queries against the outline", async () => {
    const { Wrapper } = createTestWrapper();
    const outlineHook = renderHook(
      () => {
        const storeFromContext = useOutlineStore();
        const search = usePaneSearch("outline");
        return { store: storeFromContext, search };
      },
      { wrapper: Wrapper }
    );

    await flushMicrotasks();

    await act(async () => {
      const { outline, localOrigin } = outlineHook.result.current.store.sync;
      const parentNodeId = createNode(outline, { text: "Parent", origin: localOrigin });
      addEdge(outline, {
        parentNodeId: null,
        childNodeId: parentNodeId,
        origin: localOrigin
      });
      addEdge(outline, {
        parentNodeId,
        text: "Matchable content",
        origin: localOrigin
      });
    });

    await flushMicrotasks();

    act(() => {
      outlineHook.result.current.search.setDraft("  text:matchable  ");
    });

    expect(outlineHook.result.current.search.draft).toBe("  text:matchable  ");

    let submitResult: PaneSearchSubmitResult | undefined;
    act(() => {
      submitResult = outlineHook.result.current.search.submit();
    });

    expect(submitResult).toBeDefined();
    expect(submitResult?.ok).toBe(true);
    await flushMicrotasks();

    expect(outlineHook.result.current.search.submitted).toBe("text:matchable");
    expect(outlineHook.result.current.search.resultEdgeIds.length).toBeGreaterThan(0);
    expect(outlineHook.result.current.search.runtime?.matches.size).toBeGreaterThan(0);
  });

  it("registers appended edges so they remain visible during search", async () => {
    const { Wrapper } = createTestWrapper();
    const outlineHook = renderHook(
      () => {
        const storeFromContext = useOutlineStore();
        const search = usePaneSearch("outline");
        return { store: storeFromContext, search };
      },
      { wrapper: Wrapper }
    );

    await flushMicrotasks();

    await act(async () => {
      const { outline, localOrigin } = outlineHook.result.current.store.sync;
      const parentNodeId = createNode(outline, { text: "Root", origin: localOrigin });
      addEdge(outline, {
        parentNodeId: null,
        childNodeId: parentNodeId,
        origin: localOrigin
      });
      addEdge(outline, {
        parentNodeId,
        text: "Initial match",
        origin: localOrigin
      });
    });

    await flushMicrotasks();

    act(() => {
      outlineHook.result.current.search.setDraft("text:initial");
    });
    act(() => {
      outlineHook.result.current.search.submit();
    });
    await flushMicrotasks();

    const appendedEdgeId = "appended-edge";
    act(() => {
      outlineHook.result.current.search.registerAppendedEdge(appendedEdgeId as EdgeId);
    });

    expect(outlineHook.result.current.search.resultEdgeIds).toContain(appendedEdgeId);
  });

  it("keeps appended edges sticky across resubmits and clears them when the query changes", async () => {
    const { Wrapper } = createTestWrapper();
    const outlineHook = renderHook(
      () => {
        const storeFromContext = useOutlineStore();
        const search = usePaneSearch("outline");
        return { store: storeFromContext, search };
      },
      { wrapper: Wrapper }
    );

    let rootNodeId: NodeId | null = null;

    await flushMicrotasks();

    await act(async () => {
      const { outline, localOrigin } = outlineHook.result.current.store.sync;
      rootNodeId = createNode(outline, { text: "Root", origin: localOrigin });
      addEdge(outline, {
        parentNodeId: null,
        childNodeId: rootNodeId,
        origin: localOrigin
      });
      addEdge(outline, {
        parentNodeId: rootNodeId,
        text: "Initial match",
        origin: localOrigin
      });
    });

    await flushMicrotasks();

    act(() => {
      outlineHook.result.current.search.setDraft("text:initial");
    });
    act(() => {
      outlineHook.result.current.search.submit();
    });
    await flushMicrotasks();

    let appendedEdgeId: EdgeId | null = null;
    await act(async () => {
      const { outline, localOrigin } = outlineHook.result.current.store.sync;
      const appended = addEdge(outline, {
        parentNodeId: rootNodeId!,
        text: "Recently created child",
        origin: localOrigin
      });
      appendedEdgeId = appended.edgeId;
    });

    await flushMicrotasks();

    act(() => {
      outlineHook.result.current.search.registerAppendedEdge(appendedEdgeId!);
    });

    await flushMicrotasks();

    const getCurrentSearchState = () =>
      outlineHook.result.current.store.session
        .getState()
        .panes.find((pane) => pane.paneId === "outline")?.search;

    const appendedId = appendedEdgeId!;

    expect(outlineHook.result.current.search.resultEdgeIds).toContain(appendedId);
    expect(getCurrentSearchState()?.appendedEdgeIds).toContain(appendedId);

    act(() => {
      outlineHook.result.current.search.submit();
    });
    await flushMicrotasks();

    expect(outlineHook.result.current.search.resultEdgeIds).toContain(appendedId);
    expect(getCurrentSearchState()?.appendedEdgeIds).toContain(appendedId);

    act(() => {
      outlineHook.result.current.search.setDraft("text:root");
    });
    act(() => {
      outlineHook.result.current.search.submit();
    });
    await flushMicrotasks();

    expect(outlineHook.result.current.search.resultEdgeIds).not.toContain(appendedId);
    expect(getCurrentSearchState()?.appendedEdgeIds).not.toContain(appendedId);
  });
});
