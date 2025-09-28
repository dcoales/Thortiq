import { useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";

import type { NodeId } from "@thortiq/sync-core";
import { createCollaborativeEditor } from "@thortiq/editor-prosemirror";
import type { CollaborativeEditor } from "@thortiq/editor-prosemirror";

import { useSyncContext } from "./OutlineProvider";

interface ActiveNodeEditorProps {
  readonly nodeId: NodeId;
  readonly initialText: string;
}

const shouldUseEditorFallback = (): boolean => {
  if (import.meta.env?.MODE !== "test") {
    return false;
  }
  const flag = (globalThis as { __THORTIQ_PROSEMIRROR_TEST__?: boolean }).__THORTIQ_PROSEMIRROR_TEST__;
  return !flag;
};

export const ActiveNodeEditor = ({ nodeId, initialText }: ActiveNodeEditorProps): JSX.Element => {
  const { outline, awareness, undoManager, localOrigin } = useSyncContext();
  const isTestFallback = shouldUseEditorFallback();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<CollaborativeEditor | null>(null);
  const debug = (...args: unknown[]) => {
    if (typeof console !== "undefined") {
      console.debug("[active-node-editor]", `node:${nodeId}`, ...args);
    }
  };

  useLayoutEffect(() => {
    if (isTestFallback) {
      return;
    }
    debug("mount effect");

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const editor = createCollaborativeEditor({
      container,
      outline,
      awareness,
      undoManager,
      localOrigin,
      nodeId
    });

    editorRef.current = editor;
    if ((globalThis as { __THORTIQ_PROSEMIRROR_TEST__?: boolean }).__THORTIQ_PROSEMIRROR_TEST__) {
      (globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__ = editor;
    }
    editor.focus();
    debug("editor created");

    return () => {
      debug("cleanup effect");
      if ((globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__ === editor) {
        delete (globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__;
      }
      editor.destroy();
      editorRef.current = null;
    };
  }, [outline, awareness, undoManager, localOrigin, nodeId, isTestFallback]);

  if (isTestFallback) {
    return <span style={styles.fallbackText}>{initialText || "Untitled node"}</span>;
  }

  return <div ref={containerRef} style={styles.editorContainer} />;
};

const styles: Record<string, CSSProperties> = {
  editorContainer: {
    width: "100%",
    minHeight: "28px"
  },
  fallbackText: {
    display: "block",
    width: "100%",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word"
  }
};
