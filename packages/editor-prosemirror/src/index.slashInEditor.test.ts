import { describe, expect, it } from "vitest";
import { createCollaborativeEditor } from "./index";
import { createSyncContext } from "@thortiq/sync-core";
import { createNode } from "@thortiq/client-core";

describe("editor slash plugin wiring", () => {
  it("creates an editor with slashOptions without throwing", () => {
    const sync = createSyncContext();
    const nodeId = createNode(sync.outline, { text: "Hello" });
    const editor = createCollaborativeEditor({
      container: document.createElement("div"),
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId,
      slashOptions: { onStateChange: () => {} }
    });
    expect(editor.view).toBeTruthy();
    editor.destroy();
  });
});


