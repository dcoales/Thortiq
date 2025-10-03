import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Selection, TextSelection } from "prosemirror-state";
import type { Node as ProseMirrorNode } from "prosemirror-model";

import {
  getChildEdgeIds,
  getEdgeSnapshot,
  setNodeText,
  type EdgeId
} from "@thortiq/client-core";
import type { NodeId } from "@thortiq/sync-core";
import { createCollaborativeEditor } from "@thortiq/editor-prosemirror";
import type {
  CollaborativeEditor,
  OutlineSelectionAdapter,
  OutlineCursorPlacement,
  OutlineKeymapOptions,
  OutlineKeymapHandlers,
  OutlineKeymapHandler
} from "@thortiq/editor-prosemirror";

import {
  useAwarenessIndicatorsEnabled,
  useSyncContext,
  useSyncDebugLoggingEnabled
} from "./OutlineProvider";
import {
  indentEdges,
  insertChild,
  insertChildAtStart,
  insertSiblingAbove,
  insertSiblingBelow,
  mergeWithPrevious,
  outdentEdges,
  toggleTodoDoneCommand
} from "@thortiq/outline-commands";

export type PendingCursorRequest =
  | {
      readonly placement: "coords";
      readonly clientX: number;
      readonly clientY: number;
    }
  | {
      readonly placement: "text-end";
    }
  | {
      readonly placement: "text-start";
    }
  | {
      readonly placement: "text-offset";
      readonly index: number;
    };

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const resolveDocPositionFromTextOffset = (doc: ProseMirrorNode, offset: number): number => {
  const totalLength = doc.textBetween(0, doc.content.size, "\n", "\n").length;
  const target = clamp(offset, 0, totalLength);
  let remaining = target;
  let resolved = 0;

  doc.descendants((node, pos) => {
    if (!node.isText) {
      return true;
    }
    const textLength = node.text?.length ?? 0;
    if (remaining <= textLength) {
      resolved = pos + remaining;
      return false;
    }
    remaining -= textLength;
    resolved = pos + textLength;
    return true;
  });

  return resolved;
};

interface ActiveRowSummary {
  readonly hasChildren: boolean;
  readonly collapsed: boolean;
  readonly visibleChildCount: number;
}

interface ActiveNodeEditorProps {
  readonly nodeId: NodeId | null;
  readonly container: HTMLDivElement | null;
  readonly pendingCursor?: PendingCursorRequest | null;
  readonly onPendingCursorHandled?: () => void;
  readonly selectionAdapter: OutlineSelectionAdapter;
  readonly activeRow?: ActiveRowSummary | null;
  readonly onDeleteSelection?: () => boolean;
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
  onPendingCursorHandled,
  selectionAdapter,
  activeRow,
  onDeleteSelection
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

  const outlineKeymapOptions = useMemo<OutlineKeymapOptions>(() => {
    const commandContext = { outline, origin: localOrigin };

    const getOrderedSelection = (): readonly EdgeId[] => {
      const ordered = selectionAdapter.getOrderedEdgeIds();
      if (ordered.length > 0) {
        return ordered;
      }
      const primary = selectionAdapter.getPrimaryEdgeId();
      return primary ? [primary] : [];
    };

    const resetSelection = (
      nextPrimary: EdgeId | null,
      options: { readonly preserveRange?: boolean; readonly cursor?: OutlineCursorPlacement } = {}
    ) => {
      if (!options.preserveRange) {
        selectionAdapter.clearRange();
      }
      selectionAdapter.setPrimaryEdgeId(nextPrimary, options.cursor ? { cursor: options.cursor } : undefined);
    };

    const indent: OutlineKeymapHandler = () => {
      const primary = selectionAdapter.getPrimaryEdgeId();
      const edgeIds = getOrderedSelection();
      if (edgeIds.length === 0) {
        return false;
      }
      const preserveRange = edgeIds.length > 1;
      const results = indentEdges(commandContext, [...edgeIds].reverse());
      if (!results) {
        return false;
      }
      const fallback = results[results.length - 1]?.edgeId ?? null;
      resetSelection(primary ?? fallback, { preserveRange });
      return true;
    };

    const outdent: OutlineKeymapHandler = () => {
      const primary = selectionAdapter.getPrimaryEdgeId();
      const edgeIds = getOrderedSelection();
      if (edgeIds.length === 0) {
        return false;
      }
      const preserveRange = edgeIds.length > 1;
      const results = outdentEdges(commandContext, edgeIds);
      if (!results) {
        return false;
      }
      const fallback = results[0]?.edgeId ?? null;
      resetSelection(primary ?? fallback, { preserveRange });
      return true;
    };

    const insertSibling: OutlineKeymapHandler = ({ state }) => {
      const primary = selectionAdapter.getPrimaryEdgeId();
      if (!primary) {
        return false;
      }
      const selection = state.selection;
      if (!selection.empty) {
        return false;
      }
      const { from } = selection;
      const doc = state.doc;
      const textBefore = doc.textBetween(0, from, "\n", "\n");
      const textAfter = doc.textBetween(from, doc.content.size, "\n", "\n");
      const atStart = textBefore.length === 0;
      const atEnd = textAfter.length === 0;
      const edgeSnapshot = getEdgeSnapshot(outline, primary);
      const targetNodeId = edgeSnapshot.childNodeId;
      const childEdgeIds = getChildEdgeIds(outline, targetNodeId);
      const hasChildren = childEdgeIds.length > 0;
      const visibleChildCount = activeRow?.visibleChildCount ?? 0;
      const isExpanded = hasChildren && visibleChildCount > 0;

      if (!atStart && !atEnd) {
        setNodeText(outline, targetNodeId, textBefore, localOrigin);
        const result = insertSiblingBelow(commandContext, primary);
        if (textAfter.length > 0) {
          setNodeText(outline, result.nodeId, textAfter, localOrigin);
        }
        resetSelection(result.edgeId, { cursor: "start" });
        return true;
      }

      if (atStart && !atEnd) {
        const result = insertSiblingAbove(commandContext, primary);
        resetSelection(result.edgeId, { cursor: "start" });
        return true;
      }

      if (atEnd) {
        if (isExpanded) {
          const childResult = insertChildAtStart(commandContext, primary);
          resetSelection(childResult.edgeId, { cursor: "start" });
          return true;
        }
        const result = insertSiblingBelow(commandContext, primary);
        resetSelection(result.edgeId, { cursor: "start" });
        return true;
      }

      return false;
    };

    const insertChildHandler: OutlineKeymapHandler = () => {
      const primary = selectionAdapter.getPrimaryEdgeId();
      if (!primary) {
        return false;
      }
      const result = insertChild(commandContext, primary);
      resetSelection(result.edgeId, { cursor: "start" });
      return true;
    };

    const mergeWithPreviousHandler: OutlineKeymapHandler = ({ state }) => {
      const primary = selectionAdapter.getPrimaryEdgeId();
      if (!primary) {
        return false;
      }
      const selection = state.selection;
      if (!selection.empty) {
        return false;
      }
      if (selection.$from.parentOffset !== 0) {
        return false;
      }

      const mergeResult = mergeWithPrevious(commandContext, primary);
      if (!mergeResult) {
        return false;
      }

      resetSelection(mergeResult.edgeId, { cursor: mergeResult.cursor });
      return true;
    };

    const deleteSelectionHandler: OutlineKeymapHandler | undefined = onDeleteSelection
      ? () => onDeleteSelection()
      : undefined;

    const toggleDone: OutlineKeymapHandler = () => {
      const edgeIds = getOrderedSelection();
      if (edgeIds.length === 0) {
        return false;
      }
      const result = toggleTodoDoneCommand(commandContext, edgeIds);
      return result !== null;
    };

    const handlers: OutlineKeymapHandlers = {
      indent,
      outdent,
      insertSibling,
      insertChild: insertChildHandler,
      mergeWithPrevious: mergeWithPreviousHandler,
      deleteSelection: deleteSelectionHandler,
      toggleDone
    };

    return { handlers };
  }, [activeRow, localOrigin, onDeleteSelection, outline, selectionAdapter]);

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
        debugLoggingEnabled: syncDebugLoggingEnabled,
        outlineKeymapOptions
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
    editor.setOutlineKeymapOptions(outlineKeymapOptions);
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
    syncDebugLoggingEnabled,
    outlineKeymapOptions
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
      if (pendingCursor.placement === "text-start") {
        const { state } = view;
        const selection = Selection.atStart(state.doc);
        if (!state.selection.eq(selection)) {
          const transaction = state.tr.setSelection(selection);
          view.dispatch(transaction);
        }
        finish();
        return;
      }
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
      if (pendingCursor.placement === "text-offset") {
        const { state } = view;
        const targetPosition = resolveDocPositionFromTextOffset(state.doc, pendingCursor.index);
        if (state.selection.from !== targetPosition || state.selection.to !== targetPosition) {
          const selection = TextSelection.create(state.doc, targetPosition);
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
