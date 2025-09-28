import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

import type { NodeId } from "@thortiq/sync-core";
import { createCollaborativeEditor } from "@thortiq/editor-prosemirror";
import type { CollaborativeEditor } from "@thortiq/editor-prosemirror";

import { useSyncContext } from "./OutlineProvider";

interface ActiveNodeEditorProps {
  readonly nodeId: NodeId;
  readonly initialText: string;
}

const isTestEnvironment = import.meta.env?.MODE === "test";

export const ActiveNodeEditor = ({ nodeId, initialText }: ActiveNodeEditorProps): JSX.Element => {
  const { outline, awareness, undoManager, localOrigin } = useSyncContext();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<CollaborativeEditor | null>(null);

  useEffect(() => {
    if (isTestEnvironment) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const editor = createCollaborativeEditor({
      container,
      outline,
      awareness,
      undoManager,
      localOrigin
    });

    editorRef.current = editor;

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, [outline, awareness, undoManager, localOrigin]);

  useEffect(() => {
    if (isTestEnvironment) {
      return;
    }
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.setNode(nodeId);
    editor.focus();
  }, [nodeId]);

  if (isTestEnvironment) {
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
