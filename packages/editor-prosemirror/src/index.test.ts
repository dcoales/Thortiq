import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TextSelection, type Command } from "prosemirror-state";

import { createCollaborativeEditor } from "./index";
import { editorSchema } from "./schema";

import { createSyncContext } from "@thortiq/sync-core";
import { createNode, getNodeText } from "@thortiq/client-core";
import { undo } from "y-prosemirror";

const undoCommand = undo as unknown as Command;

const waitForMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

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
