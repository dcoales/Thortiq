import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TextSelection, type Command } from "prosemirror-state";

import { createCollaborativeEditor } from "./index";
import { editorSchema } from "./schema";

import { createSyncContext } from "@thortiq/sync-core";
import {
  createNode,
  createOutlineSnapshot,
  getNodeText,
  getTagRegistryEntry,
  upsertTagRegistryEntry
} from "@thortiq/client-core";
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

    upsertTagRegistryEntry(sync.outline, { label: "Alpha", trigger: "#", createdAt: 100 });
    expect(getTagRegistryEntry(sync.outline, "alpha")).not.toBeNull();

    const editor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId
    });

    expect(getTagRegistryEntry(sync.outline, "alpha")).not.toBeNull();

    expect(container.querySelectorAll(".thortiq-prosemirror")).toHaveLength(1);
    expect(editor.view.state.schema).toBe(editorSchema);

    editor.destroy();
  });

  it("synchronises text edits back into the Yjs document", () => {
    const sync = createSyncContext();
    const nodeId = createNode(sync.outline, { text: "Hello" });

    upsertTagRegistryEntry(sync.outline, { label: "Shared", trigger: "#", createdAt: 100 });
    expect(getTagRegistryEntry(sync.outline, "shared")).not.toBeNull();

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

  it("updates outline key handlers without clearing the active wiki trigger", () => {
    const sync = createSyncContext();
    const nodeId = createNode(sync.outline, { text: "" });
    const first = vi.fn().mockReturnValue(true);
    const second = vi.fn().mockReturnValue(true);
    const third = vi.fn().mockReturnValue(true);

    const editor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId,
      outlineKeymapOptions: {
        handlers: {
          arrowDown: () => first()
        }
      }
    });

    const firstEvent = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
    editor.view.dom.dispatchEvent(firstEvent);
    expect(first).toHaveBeenCalledTimes(1);

    editor.setOutlineKeymapOptions({
      handlers: {
        arrowDown: () => second()
      }
    });
    const secondEvent = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
    editor.view.dom.dispatchEvent(secondEvent);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);

    editor.view.dispatch(editor.view.state.tr.insertText("[["));
    editor.view.dispatch(editor.view.state.tr.insertText("Alpha"));
    expect(editor.getWikiLinkTrigger()).toMatchObject({ query: "Alpha" });

    editor.setOutlineKeymapOptions({
      handlers: {
        arrowDown: () => third()
      }
    });

    expect(editor.getWikiLinkTrigger()).toMatchObject({ query: "Alpha" });

    editor.destroy();
  });

  it("applies tag suggestions and updates registry timestamps", () => {
    const sync = createSyncContext();
    upsertTagRegistryEntry(sync.outline, { label: "Plan", trigger: "#", createdAt: 100 });
    const nodeId = createNode(sync.outline, { text: "" });

    const editor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId
    });

    editor.view.dispatch(editor.view.state.tr.insertText("#"));
    editor.view.dispatch(editor.view.state.tr.insertText("plan"));
    expect(editor.getTagTrigger()).not.toBeNull();

    const applied = editor.applyTag({ id: "plan", label: "Plan", trigger: "#" });
    expect(applied).toBe(true);

    const docText = editor.view.state.doc.textContent;
    expect(docText).toBe("#Plan ");

    const textNode = editor.view.state.doc.firstChild?.firstChild;
    expect(textNode?.marks[0]?.type.name).toBe("tag");
    expect(textNode?.marks[0]?.attrs).toMatchObject({ id: "plan", trigger: "#", label: "Plan" });

    const registryEntry = getTagRegistryEntry(sync.outline, "plan");
    expect(registryEntry).not.toBeNull();
    expect(registryEntry?.lastUsedAt).toBeGreaterThanOrEqual(100);

    editor.destroy();
  });

  it("reopens tag suggestions when backspacing into a tag pill", () => {
    const sync = createSyncContext();
    upsertTagRegistryEntry(sync.outline, { label: "Plan", trigger: "#", createdAt: 100 });
    const nodeId = createNode(sync.outline, { text: "" });

    const editor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId
    });

    editor.setTagOptions({ onStateChange: vi.fn() });

    editor.view.dispatch(editor.view.state.tr.insertText("#"));
    editor.view.dispatch(editor.view.state.tr.insertText("plan"));
    expect(editor.applyTag({ id: "plan", label: "Plan", trigger: "#" })).toBe(true);

    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));

    const plainNode = editor.view.state.doc.firstChild?.firstChild;
    expect((plainNode?.text ?? "").trim()).toBe("#Plan");

  editor.destroy();
});

  it("removes tag registry entries when the final instance is deleted", () => {
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

    editor.view.dispatch(editor.view.state.tr.insertText("#"));
    editor.view.dispatch(editor.view.state.tr.insertText("alpha"));
    upsertTagRegistryEntry(sync.outline, { label: "Alpha", trigger: "#", createdAt: 100 });
    expect(getTagRegistryEntry(sync.outline, "alpha")).not.toBeNull();
    expect(editor.applyTag({ id: "alpha", label: "Alpha", trigger: "#" })).toBe(true);
    expect(getTagRegistryEntry(sync.outline, "alpha")).not.toBeNull();

    const deleteTransaction = editor.view.state.tr.delete(0, editor.view.state.doc.content.size);
    editor.view.dispatch(deleteTransaction);

    expect(getTagRegistryEntry(sync.outline, "alpha")).toBeNull();

    editor.destroy();
  });

  it("retains registry entries when other nodes still reference the tag", () => {
    const sync = createSyncContext();
    const firstNodeId = createNode(sync.outline, { text: "" });
    const secondNodeId = createNode(sync.outline, { text: "" });

    const editor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId: firstNodeId
    });

    editor.view.dispatch(editor.view.state.tr.insertText("#"));
    editor.view.dispatch(editor.view.state.tr.insertText("shared"));
    upsertTagRegistryEntry(sync.outline, { label: "Shared", trigger: "#", createdAt: 100 });
    expect(getTagRegistryEntry(sync.outline, "shared")).not.toBeNull();
    expect(editor.applyTag({ id: "shared", label: "Shared", trigger: "#" })).toBe(true);

    editor.setNode(secondNodeId);
    editor.view.dispatch(editor.view.state.tr.insertText("#"));
    editor.view.dispatch(editor.view.state.tr.insertText("shared"));
    expect(editor.applyTag({ id: "shared", label: "Shared", trigger: "#" })).toBe(true);

    editor.setNode(firstNodeId);
    const removeFirst = editor.view.state.tr.delete(0, editor.view.state.doc.content.size);
    editor.view.dispatch(removeFirst);

    expect(getTagRegistryEntry(sync.outline, "shared")).not.toBeNull();

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
    const caretPos = editor.view.state.selection.from;
    expect(editor.view.state.doc.textBetween(caretPos - 1, caretPos, "\n", "\n")).toBe(" ");

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

  it("places the caret after an existing trailing space when applying a wiki link", () => {
    const sync = createSyncContext();
    const nodeId = createNode(sync.outline, { text: "" });
    const targetNodeId = createNode(sync.outline, { text: "Existing" });

    const editor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId
    });

    editor.view.dispatch(editor.view.state.tr.insertText("[["));
    editor.view.dispatch(editor.view.state.tr.insertText("Existing"));
    editor.view.dispatch(editor.view.state.tr.insertText(" "));

    const applied = editor.applyWikiLink({ targetNodeId, displayText: "Existing" });
    expect(applied).toBe(true);
    expect(editor.view.state.doc.textContent).toBe("Existing ");
    const caretPos = editor.view.state.selection.from;
    expect(editor.view.state.doc.textBetween(caretPos - 1, caretPos, "\n", "\n")).toBe(" ");

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

  it("invokes the wiki link activation callback on click", () => {
    const sync = createSyncContext();
    const nodeId = createNode(sync.outline, { text: "" });
    const targetNodeId = createNode(sync.outline, { text: "Target" });
    const onActivate = vi.fn();

    const editor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId,
      wikiLinkOptions: {
        onActivate
      }
    });

    editor.view.dispatch(editor.view.state.tr.insertText("[["));
    editor.view.dispatch(editor.view.state.tr.insertText("Target"));
    const applied = editor.applyWikiLink({ targetNodeId, displayText: "Target" });
    expect(applied).toBe(true);

    const link = editor.view.dom.querySelector('[data-wikilink="true"]');
    expect(link).toBeInstanceOf(HTMLElement);

    link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0][0]).toMatchObject({ nodeId: targetNodeId });
    expect(onActivate.mock.calls[0][0].view).toBe(editor.view);

    editor.destroy();
  });

  it("invokes wiki link hover callbacks on pointer transitions", () => {
    const sync = createSyncContext();
    const nodeId = createNode(sync.outline, { text: "" });
    const targetNodeId = createNode(sync.outline, { text: "Target" });
    const onHover = vi.fn();

    const editor = createCollaborativeEditor({
      container,
      outline: sync.outline,
      awareness: sync.awareness,
      undoManager: sync.undoManager,
      localOrigin: sync.localOrigin,
      nodeId,
      wikiLinkOptions: {
        onHover
      }
    });

    editor.view.dispatch(editor.view.state.tr.insertText("[["));
    editor.view.dispatch(editor.view.state.tr.insertText("Target"));
    const applied = editor.applyWikiLink({ targetNodeId, displayText: "Target" });
    expect(applied).toBe(true);

    const link = editor.view.dom.querySelector('[data-wikilink="true"]');
    expect(link).toBeInstanceOf(HTMLElement);

    link?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    link?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));

    expect(onHover).toHaveBeenCalledTimes(2);
    expect(onHover.mock.calls[0][0]).toMatchObject({ type: "enter", nodeId: targetNodeId });
    expect(onHover.mock.calls[0][0].element).toBe(link);
    expect(onHover.mock.calls[1][0]).toMatchObject({ type: "leave", nodeId: targetNodeId });

    editor.destroy();
  });

  it("surfaces mirror trigger state while typing a query", () => {
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
      mirrorOptions: {
        onStateChange: (payload) => {
          events.push(payload ? payload.trigger.query : null);
        }
      }
    });

    editor.view.dispatch(editor.view.state.tr.insertText("(("));
    editor.view.dispatch(editor.view.state.tr.insertText("Alpha"));

    expect(editor.getMirrorTrigger()).toMatchObject({ query: "Alpha" });
    expect(events.at(-1)).toBe("Alpha");

    editor.destroy();
  });

  it("consumes the mirror trigger and clears typed characters", () => {
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

    editor.view.dispatch(editor.view.state.tr.insertText("(("));
    editor.view.dispatch(editor.view.state.tr.insertText("Target"));

    const trigger = editor.consumeMirrorTrigger();
    expect(trigger).toMatchObject({ query: "Target" });
    expect(editor.getMirrorTrigger()).toBeNull();
    expect(editor.view.state.doc.textContent).toBe("");

    editor.destroy();
  });

  it("cancels the mirror trigger by removing typed characters", () => {
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

    editor.view.dispatch(editor.view.state.tr.insertText("(("));
    editor.view.dispatch(editor.view.state.tr.insertText("Target"));

    editor.cancelMirrorTrigger();
    expect(editor.getMirrorTrigger()).toBeNull();
    expect(editor.view.state.doc.textContent).toBe("");

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
