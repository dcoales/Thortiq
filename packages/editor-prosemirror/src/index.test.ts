import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TextSelection, type Command } from "prosemirror-state";

import { createCollaborativeEditor } from "./index";
import { editorSchema } from "./schema";

import { createSyncContext } from "@thortiq/sync-core";
import { createNode, createOutlineSnapshot, getNodeText } from "@thortiq/client-core";
import { undo } from "y-prosemirror";

const undoCommand = undo as unknown as Command;

const waitForMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

const OriginalMutationObserver = globalThis.MutationObserver;

beforeAll(() => {
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof MutationObserver;
});

afterAll(() => {
  if (OriginalMutationObserver) {
    globalThis.MutationObserver = OriginalMutationObserver;
  } else {
    delete (globalThis as Record<string, unknown>).MutationObserver;
  }
});

describe("createCollaborativeEditor", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("mounts a ProseMirror editor bound to a node fragment", () => {
    const sync = createSyncContext();
    const nodeId = createNode(sync.outline, { text: "Hello" });

    const editor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId
    });

    expect(container.querySelectorAll(".thortiq-prosemirror")).toHaveLength(1);
    expect(editor.view.state.schema).toBe(editorSchema);

    editor.destroy();
  });

  it("synchronises text edits back into the Yjs document", () => {
    const sync = createSyncContext();
    const nodeId = createNode(sync.outline, { text: "Hello" });

    const editor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId
    });

    const endSelection = editor.view.state.tr.setSelection(
      TextSelection.atEnd(editor.view.state.doc)
    );
    editor.view.dispatch(endSelection);
    editor.view.dispatch(editor.view.state.tr.insertText(" world"));

    expect(getNodeText(sync.outline, nodeId)).toBe("Hello world");

    editor.destroy();
  });

  it("reuses the same editor instance across nodes", () => {
    const sync = createSyncContext();
    const firstId = createNode(sync.outline, { text: "First" });
    const secondId = createNode(sync.outline, { text: "Second" });

    const editor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId: firstId
    });

    const initialView = editor.view;
    expect(initialView.state.doc.textContent).toBe("First");

    editor.setNode(secondId);
    expect(editor.view).toBe(initialView);
    expect(editor.view.state.doc.textContent).toBe("Second");

    const secondaryContainer = document.createElement("div");
    document.body.appendChild(secondaryContainer);
    editor.setContainer(secondaryContainer);
    expect(secondaryContainer.querySelector(".thortiq-prosemirror")).toBe(editor.view.dom);

    editor.destroy();
    secondaryContainer.remove();
  });

  it("keeps undo functional after switching nodes", () => {
    const sync = createSyncContext();
    const firstId = createNode(sync.outline, { text: "First" });
    const secondId = createNode(sync.outline, { text: "Second" });

    const editor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId: firstId
    });

    const typeText = (text: string) => {
      const endSelection = editor.view.state.tr.setSelection(
        TextSelection.atEnd(editor.view.state.doc)
      );
      editor.view.dispatch(endSelection);
      editor.view.dispatch(editor.view.state.tr.insertText(text));
    };

    typeText(" updated");
    expect(getNodeText(sync.outline, firstId)).toBe("First updated");
    expect(undoCommand(editor.view.state, editor.view.dispatch)).toBe(true);
    expect(getNodeText(sync.outline, firstId)).toBe("First");

    editor.setNode(secondId);
    typeText(" extended");
    expect(getNodeText(sync.outline, secondId)).toBe("Second extended");
    expect(undoCommand(editor.view.state, editor.view.dispatch)).toBe(true);
    expect(getNodeText(sync.outline, secondId)).toBe("Second");

    editor.destroy();
  });

  it("invokes custom outline key handlers when provided", () => {
    const sync = createSyncContext();
    const nodeId = createNode(sync.outline, { text: "root" });
    const indent = vi.fn().mockReturnValue(true);

    const editor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId,
      outlineKeymapOptions: {
        handlers: {
          indent: () => indent()
        }
      }
    });

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    editor.view.dom.dispatchEvent(event);

    expect(indent).toHaveBeenCalledOnce();
    expect(preventDefaultSpy).toHaveBeenCalledOnce();

    editor.destroy();
  });

  it("surfaces wiki link trigger state while typing a query", () => {
    const sync = createSyncContext();
    const nodeId = createNode(sync.outline, { text: "" });
    const events: Array<string | null> = [];

    const editor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId,
      wikiLinkOptions: {
        onStateChange: (payload) => {
          events.push(payload ? payload.trigger.query : null);
        }
      }
    });

    editor.view.dispatch(editor.view.state.tr.insertText("[["));
    editor.view.dispatch(editor.view.state.tr.insertText("Alpha"));

    expect(editor.getWikiLinkTrigger()).toMatchObject({ query: "Alpha" });
    expect(events.at(-1)).toBe("Alpha");

    editor.destroy();
  });

  it("converts the active trigger into a wiki link with trailing space", () => {
    const sync = createSyncContext();
    const nodeId = createNode(sync.outline, { text: "" });
    const targetNodeId = createNode(sync.outline, { text: "Target" });

    const editor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId
    });

    editor.view.dispatch(editor.view.state.tr.insertText("[["));
    editor.view.dispatch(editor.view.state.tr.insertText("Target"));

    const applied = editor.applyWikiLink({ targetNodeId, displayText: "Target" });
    expect(applied).toBe(true);
    expect(editor.getWikiLinkTrigger()).toBeNull();
    expect(editor.view.state.doc.textContent).toBe("Target ");

    const paragraph = editor.view.state.doc.child(0);
    const textNode = paragraph.child(0);
    expect(textNode.marks[0]?.type.name).toBe("wikilink");
    expect(textNode.marks[0]?.attrs.nodeId).toBe(targetNodeId);

    const snapshot = createOutlineSnapshot(sync.outline);
    const inlineContent = snapshot.nodes.get(nodeId)?.inlineContent ?? [];
    expect(inlineContent[0]?.marks[0]?.type).toBe("wikilink");
    expect(inlineContent[0]?.marks[0]?.attrs).toMatchObject({ nodeId: targetNodeId });

    editor.destroy();
  });

  it("cancels the trigger by removing typed characters", () => {
    const sync = createSyncContext();
    const nodeId = createNode(sync.outline, { text: "" });

    const editor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId
    });

    editor.view.dispatch(editor.view.state.tr.insertText("[["));
    editor.view.dispatch(editor.view.state.tr.insertText("Alpha"));

    editor.cancelWikiLink();
    expect(editor.view.state.doc.textContent).toBe("");
    expect(editor.getWikiLinkTrigger()).toBeNull();

    editor.destroy();
  });

  it.skip("surfaces awareness update issues after destroying the view", async () => {
    const sync = createSyncContext();
    const firstId = createNode(sync.outline, { text: "first" });
    const secondId = createNode(sync.outline, { text: "second" });

    const firstEditor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId: firstId
    });

    sync.awareness.setLocalStateField("cursor", { anchor: 0, head: 0 });
    await waitForMicrotasks();

    firstEditor.destroy();

    const secondEditor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId: secondId
    });

    const captured = await new Promise<Error | null>((resolve) => {
      const handler = (event: ErrorEvent) => {
        event.preventDefault();
        clearTimeout(timer);
        window.removeEventListener("error", handler);
        resolve(event.error ?? null);
      };

      const timer = setTimeout(() => {
        window.removeEventListener("error", handler);
        resolve(null);
      }, 200);

      window.addEventListener("error", handler);
      sync.awareness.setLocalStateField("cursor", { anchor: 0, head: 0 });
    });

    expect(captured?.message ?? "").toMatch(/Unexpected case/);

    await waitForMicrotasks();
    secondEditor.destroy();
  });
});
