import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Selection, TextSelection } from "prosemirror-state";

import type { NodeId } from "@thortiq/sync-core";
import { createCollaborativeEditor } from "@thortiq/editor-prosemirror";
import type { CollaborativeEditor } from "@thortiq/editor-prosemirror";

import {
  useAwarenessIndicatorsEnabled,
  useSyncContext,
  useSyncDebugLoggingEnabled
} from "./OutlineProvider";

export type PendingCursorRequest =
  | {
      readonly placement: "coords";
      readonly clientX: number;
      readonly clientY: number;
    }
  | {
      readonly placement: "text-end";
    };

interface ActiveNodeEditorProps {
  readonly nodeId: NodeId | null;
  readonly container: HTMLDivElement | null;
  readonly pendingCursor?: PendingCursorRequest | null;
  readonly onPendingCursorHandled?: () => void;
}

const shouldUseEditorFallback = (): boolean => {
  if (import.meta.env?.MODE !== "test") {
    return false;
  }
  const flag = (globalThis as { __THORTIQ_PROSEMIRROR_TEST__?: boolean }).__THORTIQ_PROSEMIRROR_TEST__;
  return !flag;
};
export const ActiveNodeEditor = ({
  nodeId,
  container,
  pendingCursor = null,
  onPendingCursorHandled
}: ActiveNodeEditorProps): JSX.Element | null => {
  const { outline, awareness, undoManager, localOrigin } = useSyncContext();
  const awarenessIndicatorsEnabled = useAwarenessIndicatorsEnabled();
  const syncDebugLoggingEnabled = useSyncDebugLoggingEnabled();
  const isTestFallback = shouldUseEditorFallback();
  const editorRef = useRef<CollaborativeEditor | null>(null);
  const lastNodeIdRef = useRef<NodeId | null>(null);
  const lastIndicatorsEnabledRef = useRef<boolean>(awarenessIndicatorsEnabled);
  const lastDebugLoggingRef = useRef<boolean>(syncDebugLoggingEnabled);
  // Keep an off-DOM host so we can temporarily park the editor between row switches.
  const detachedHost = useMemo(() => document.createElement("div"), []);

  useLayoutEffect(() => {
    if (isTestFallback) {
      return;
    }
    return () => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }
      if ((globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__ === editor) {
        delete (globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__;
      }
      editor.destroy();
      editorRef.current = null;
      lastNodeIdRef.current = null;
    };
  }, [isTestFallback]);

  useLayoutEffect(() => {
    if (isTestFallback) {
      return;
    }
    if (!container || !nodeId) {
      return;
    }

    if (
      editorRef.current
      && (lastIndicatorsEnabledRef.current !== awarenessIndicatorsEnabled
        || lastDebugLoggingRef.current !== syncDebugLoggingEnabled)
    ) {
      editorRef.current.destroy();
      editorRef.current = null;
    }

    let editor = editorRef.current;
    if (!editor) {
      editor = createCollaborativeEditor({
        container,
        outline,
        awareness,
        undoManager,
        localOrigin,
        nodeId,
        awarenessIndicatorsEnabled,
        awarenessDebugLoggingEnabled: awarenessIndicatorsEnabled && syncDebugLoggingEnabled,
        debugLoggingEnabled: syncDebugLoggingEnabled
      });
      editorRef.current = editor;
      if ((globalThis as { __THORTIQ_PROSEMIRROR_TEST__?: boolean }).__THORTIQ_PROSEMIRROR_TEST__) {
        (globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__ = editor;
      }
    } else {
      editor.setContainer(container);
      if (lastNodeIdRef.current !== nodeId) {
        editor.setNode(nodeId);
      }
    }
    lastNodeIdRef.current = nodeId;
    lastIndicatorsEnabledRef.current = awarenessIndicatorsEnabled;
    lastDebugLoggingRef.current = syncDebugLoggingEnabled;
    editor.focus();

    return () => {
      if (!editorRef.current) {
        return;
      }
      editorRef.current.setContainer(detachedHost);
    };
  }, [
    awareness,
    awarenessIndicatorsEnabled,
    container,
    detachedHost,
    isTestFallback,
    localOrigin,
    nodeId,
    outline,
    undoManager,
    syncDebugLoggingEnabled
  ]);

  useEffect(() => {
    if (!isTestFallback) {
      return;
    }
    if (pendingCursor) {
      onPendingCursorHandled?.();
    }
  }, [isTestFallback, onPendingCursorHandled, pendingCursor]);

  useEffect(() => {
    if (isTestFallback) {
      return;
    }
    if (!pendingCursor) {
      return;
    }
    // Retry selection for a few frames so the freshly mounted view can measure DOM accurately.
    let attempts = 4;
    let cancelled = false;
    let completed = false;

    const finish = () => {
      if (completed) {
        return;
      }
      completed = true;
      cancelled = true;
      onPendingCursorHandled?.();
    };

    const tryResolveSelection = () => {
      if (cancelled) {
        return;
      }
      const editor = editorRef.current;
      if (!editor) {
        attempts -= 1;
        if (attempts <= 0) {
          finish();
          return;
        }
        requestAnimationFrame(tryResolveSelection);
        return;
      }
      const { view } = editor;
      view.focus();
      if (pendingCursor.placement === "text-end") {
        const { state } = view;
        const selection = Selection.atEnd(state.doc);
        if (!state.selection.eq(selection)) {
          const transaction = state.tr.setSelection(selection);
          view.dispatch(transaction);
        }
        finish();
        return;
      }
      const resolved = view.posAtCoords({ left: pendingCursor.clientX, top: pendingCursor.clientY });
      if (resolved) {
        const position = resolved.pos;
        const { state } = view;
        if (state.selection.from !== position || state.selection.to !== position) {
          const selection = TextSelection.create(state.doc, position);
          const transaction = state.tr.setSelection(selection);
          view.dispatch(transaction);
        }
        finish();
        return;
      }
      attempts -= 1;
      if (attempts <= 0) {
        finish();
        return;
      }
      requestAnimationFrame(tryResolveSelection);
    };

    requestAnimationFrame(tryResolveSelection);

    return () => {
      cancelled = true;
      if (!completed) {
        onPendingCursorHandled?.();
        completed = true;
      }
    };
  }, [pendingCursor, onPendingCursorHandled, isTestFallback]);
  return null;
};
