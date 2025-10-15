import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireSharedEditor,
  detachSharedEditor,
  registerEditorMount,
  registerEditorUnmount,
  resetSharedEditorForTests
} from "../sharedCollaborativeEditor";
import type { CollaborativeEditor } from "@thortiq/editor-prosemirror";

const createStubEditor = () => {
  const containerHistory: HTMLDivElement[] = [];
  const nodeHistory: string[] = [];
  let destroyed = false;

  const editor = {
    setContainer: vi.fn((container: HTMLDivElement) => {
      containerHistory.push(container);
    }),
    setNode: vi.fn((nodeId: string) => {
      nodeHistory.push(nodeId);
    }),
    focus: vi.fn(),
    destroy: vi.fn(() => {
      destroyed = true;
    })
  } as unknown as CollaborativeEditor;

  return {
    editor,
    containerHistory,
    nodeHistory,
    destroyed: () => destroyed
  };
};

describe("sharedCollaborativeEditor", () => {
  beforeEach(() => {
    resetSharedEditorForTests();
  });

  it("reuses the same editor across pane acquisitions", () => {
    registerEditorMount();
    const primaryHost = document.createElement("div");
    const secondaryHost = document.createElement("div");
    const detachedHost = document.createElement("div");
    const stub = createStubEditor();

    const createEditor = vi.fn((container: HTMLDivElement, nodeId: string) => {
      stub.containerHistory.push(container);
      stub.nodeHistory.push(nodeId);
      return stub.editor;
    });

    const first = acquireSharedEditor({
      paneId: "pane-a",
      container: primaryHost,
      nodeId: "edge-a",
      awarenessIndicatorsEnabled: true,
      debugLoggingEnabled: false,
      createEditor
    });
    expect(first.created).toBe(true);
    expect(createEditor).toHaveBeenCalledOnce();
    expect(stub.containerHistory.at(-1)).toBe(primaryHost);
    expect(stub.nodeHistory.at(-1)).toBe("edge-a");

    detachSharedEditor("pane-a", detachedHost);

    const second = acquireSharedEditor({
      paneId: "pane-b",
      container: secondaryHost,
      nodeId: "edge-b",
      awarenessIndicatorsEnabled: true,
      debugLoggingEnabled: false,
      createEditor
    });
    expect(second.created).toBe(false);
    expect(createEditor).toHaveBeenCalledTimes(1);
    expect(stub.editor.setContainer).toHaveBeenCalledWith(secondaryHost);
    expect(stub.editor.setNode).toHaveBeenCalledWith("edge-b");

    detachSharedEditor("pane-b", detachedHost);
    const destroyed = registerEditorUnmount("pane-b");
    expect(destroyed).toBe(stub.editor);
    expect(stub.destroyed()).toBe(true);
  });

  it("recreates the editor when awareness configuration changes", () => {
    registerEditorMount();
    const host = document.createElement("div");
    const detachedHost = document.createElement("div");

    const firstStub = createStubEditor();
    const secondStub = createStubEditor();

    const createEditor = vi
      .fn<[HTMLDivElement, string], CollaborativeEditor>()
      .mockImplementationOnce((container, nodeId) => {
        firstStub.containerHistory.push(container);
        firstStub.nodeHistory.push(nodeId);
        return firstStub.editor;
      })
      .mockImplementationOnce((container, nodeId) => {
        secondStub.containerHistory.push(container);
        secondStub.nodeHistory.push(nodeId);
        return secondStub.editor;
      });

    acquireSharedEditor({
      paneId: "pane-a",
      container: host,
      nodeId: "edge-a",
      awarenessIndicatorsEnabled: false,
      debugLoggingEnabled: false,
      createEditor
    });
    detachSharedEditor("pane-a", detachedHost);

    const second = acquireSharedEditor({
      paneId: "pane-b",
      container: host,
      nodeId: "edge-b",
      awarenessIndicatorsEnabled: true,
      debugLoggingEnabled: true,
      createEditor
    });

    expect(second.created).toBe(true);
    expect(createEditor).toHaveBeenCalledTimes(2);
    expect(firstStub.destroyed()).toBe(true);
    expect(secondStub.destroyed()).toBe(false);
    expect(secondStub.containerHistory.at(-1)).toBe(host);
    expect(secondStub.nodeHistory.at(-1)).toBe("edge-b");

    detachSharedEditor("pane-b", detachedHost);
    const destroyed = registerEditorUnmount("pane-b");
    expect(destroyed).toBe(secondStub.editor);
    expect(secondStub.destroyed()).toBe(true);
  });
});
