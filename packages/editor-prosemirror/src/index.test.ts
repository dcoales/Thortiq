import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TextSelection } from "prosemirror-state";

import { createCollaborativeEditor } from "./index";
import { editorSchema } from "./schema";

import { createSyncContext } from "@thortiq/sync-core";
import { createNode, getNodeText } from "@thortiq/client-core";

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
