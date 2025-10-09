import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Selection, TextSelection } from "prosemirror-state";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";

import {
  createMirrorEdge,
  getChildEdgeIds,
  getEdgeSnapshot,
  searchMirrorCandidates,
  searchWikiLinkCandidates,
  setNodeText,
  type EdgeId,
  type OutlineSnapshot,
  type InlineSpan,
  type WikiLinkSearchCandidate
} from "@thortiq/client-core";
import type { NodeId } from "@thortiq/sync-core";
import { createCollaborativeEditor } from "@thortiq/editor-prosemirror";
import type {
  CollaborativeEditor,
  EditorMirrorOptions,
  EditorWikiLinkOptions,
  OutlineSelectionAdapter,
  OutlineCursorPlacement,
  OutlineKeymapOptions,
  OutlineKeymapHandlers
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
import { WikiLinkDialog } from "./components/WikiLinkDialog";
import { MirrorDialog, type MirrorDialogCandidate } from "./components/MirrorDialog";
import { useInlineTriggerDialog } from "./hooks/useInlineTriggerDialog";
import { useMirrorDialog } from "./hooks/useMirrorDialog";
import { projectEdgeIdForParent } from "./utils/projectEdgeId";

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

const findWikiLinkSegmentIndex = (
  view: EditorView,
  element: HTMLElement,
  inlineContent: ReadonlyArray<InlineSpan>,
  targetNodeId: NodeId
): number => {
  const position = view.posAtDOM(element, 0);
  if (position == null) {
    return -1;
  }
  const offset = view.state.doc.textBetween(0, position, "\n", "\n").length;
  const elementText = element.textContent ?? null;
  let running = 0;
  let fallbackIndex = -1;

  for (let index = 0; index < inlineContent.length; index += 1) {
    const span = inlineContent[index];
    const length = span.text.length;
    const hasMatchingMark = span.marks.some((mark) => {
      if (mark.type !== "wikilink") {
        return false;
      }
      const attributeNodeId = (mark.attrs as { nodeId?: unknown }).nodeId;
      return typeof attributeNodeId === "string" && attributeNodeId === targetNodeId;
    });

    if (hasMatchingMark) {
      if (fallbackIndex < 0) {
        fallbackIndex = index;
      }
      if (elementText && span.text === elementText) {
        fallbackIndex = index;
      }
    }

    if (offset < running + length) {
      if (hasMatchingMark) {
        return index;
      }
      break;
    }

    running += length;
  }

  return fallbackIndex;
};

type OutlineCommandContext = Parameters<typeof indentEdges>[0];

interface OutlineKeymapRuntimeState {
  commandContext: OutlineCommandContext;
  selectionAdapter: OutlineSelectionAdapter;
  activeRowEdgeId: EdgeId | null;
  activeRowAncestorEdgeIds: ReadonlyArray<EdgeId>;
  activeRowVisibleChildCount: number;
  nextVisibleEdgeId: EdgeId | null;
  previousVisibleEdgeId: EdgeId | null;
  onDeleteSelection: (() => boolean) | null;
  onAppendEdge: ((edgeId: EdgeId) => void) | null;
}

const collectOrderedEdgeIds = (adapter: OutlineSelectionAdapter): ReadonlyArray<EdgeId> => {
  const ordered = adapter.getOrderedEdgeIds();
  if (ordered.length > 0) {
    return ordered;
  }
  const primary = adapter.getPrimaryEdgeId();
  return primary ? [primary] : [];
};

const resetSelection = (
  adapter: OutlineSelectionAdapter,
  nextPrimary: EdgeId | null,
  options: { readonly preserveRange?: boolean; readonly cursor?: OutlineCursorPlacement } = {}
): void => {
  if (!options.preserveRange) {
    adapter.clearRange();
  }
  if (options.cursor) {
    adapter.setPrimaryEdgeId(nextPrimary, { cursor: options.cursor });
    return;
  }
  adapter.setPrimaryEdgeId(nextPrimary);
};

interface ActiveRowSummary {
  readonly edgeId: EdgeId;
  readonly canonicalEdgeId: EdgeId;
  readonly nodeId: NodeId;
  readonly inlineContent: ReadonlyArray<InlineSpan>;
  readonly hasChildren: boolean;
  readonly collapsed: boolean;
  readonly visibleChildCount: number;
  readonly ancestorEdgeIds: ReadonlyArray<EdgeId>;
}

interface ActiveNodeEditorProps {
  readonly nodeId: NodeId | null;
  readonly container: HTMLDivElement | null;
  readonly outlineSnapshot: OutlineSnapshot;
  readonly pendingCursor?: PendingCursorRequest | null;
  readonly onPendingCursorHandled?: () => void;
  readonly selectionAdapter: OutlineSelectionAdapter;
  readonly activeRow?: ActiveRowSummary | null;
  readonly onDeleteSelection?: () => boolean;
  readonly previousVisibleEdgeId?: EdgeId | null;
  readonly nextVisibleEdgeId?: EdgeId | null;
  readonly onWikiLinkNavigate?: (nodeId: NodeId) => void;
  readonly onWikiLinkHover?: (payload: {
    readonly type: "enter" | "leave";
    readonly edgeId: EdgeId;
    readonly sourceNodeId: NodeId;
    readonly targetNodeId: NodeId;
    readonly displayText: string;
    readonly segmentIndex: number;
    readonly element: HTMLElement;
  }) => void;
  readonly onAppendEdge?: (edgeId: EdgeId) => void;
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
  outlineSnapshot,
  pendingCursor = null,
  onPendingCursorHandled,
  selectionAdapter,
  activeRow,
  onDeleteSelection,
  previousVisibleEdgeId = null,
  nextVisibleEdgeId = null,
  onWikiLinkNavigate,
  onWikiLinkHover,
  onAppendEdge
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

  const searchInlineCandidates = useCallback(
    (query: string) =>
      searchWikiLinkCandidates(outlineSnapshot, query, {
        excludeNodeId: nodeId ?? undefined
      }),
    [outlineSnapshot, nodeId]
  );

  const searchMirrorCandidatesForDialog = useCallback(
    (query: string): MirrorDialogCandidate[] => {
      const primaryEdgeId = selectionAdapter.getPrimaryEdgeId();
      const matches = searchMirrorCandidates(outlineSnapshot, query, {
        excludeNodeId: nodeId ?? undefined,
        targetEdgeId: primaryEdgeId ?? undefined
      });
      return matches.map((candidate) => ({
        nodeId: candidate.nodeId,
        text: candidate.text,
        breadcrumb: candidate.breadcrumb
      }));
    },
    [outlineSnapshot, nodeId, selectionAdapter]
  );

  const applyWikiCandidate = useCallback((candidate: WikiLinkSearchCandidate): boolean => {
    const editor = editorRef.current;
    if (!editor) {
      return false;
    }
    const displayText = candidate.text.length > 0 ? candidate.text : "Untitled node";
    return editor.applyWikiLink({
      targetNodeId: candidate.nodeId,
      displayText
    });
  }, []);

  const cancelWikiDialog = useCallback(() => {
    editorRef.current?.cancelWikiLink();
  }, []);

  const {
    dialog: wikiDialog,
    pluginOptions: wikiLinkOptions
  } = useInlineTriggerDialog<WikiLinkSearchCandidate>({
    enabled: !isTestFallback,
    search: searchInlineCandidates,
    onApply: applyWikiCandidate,
    onCancel: cancelWikiDialog
  });

  const handleMirrorCandidate = useCallback((candidate: MirrorDialogCandidate) => {
    const editor = editorRef.current;
    if (!editor) {
      return false;
    }
    const targetEdgeId = selectionAdapter.getPrimaryEdgeId();
    if (!targetEdgeId) {
      return false;
    }
    const trigger = editor.consumeMirrorTrigger();
    if (!trigger) {
      return false;
    }

    let mirrorResult: ReturnType<typeof createMirrorEdge> | null = null;
    try {
      mirrorResult = createMirrorEdge({
        outline,
        targetEdgeId,
        mirrorNodeId: candidate.nodeId,
        origin: localOrigin
      });
    } catch (error) {
      if (typeof console !== "undefined" && typeof console.error === "function") {
        console.error("[ActiveNodeEditor] mirror command failed", error);
      }
      mirrorResult = null;
    }

    if (!mirrorResult) {
      const view = editor.view;
      const reinstate = view.state.tr.insertText("((", trigger.from, trigger.from);
      view.dispatch(reinstate);
      editor.focus();
      return false;
    }

    selectionAdapter.clearRange();
    selectionAdapter.setPrimaryEdgeId(mirrorResult.edgeId, { cursor: "end" });
    editor.focus();
    return true;
  }, [localOrigin, outline, selectionAdapter]);

  const cancelMirrorDialog = useCallback(() => {
    editorRef.current?.cancelMirrorTrigger();
  }, []);

  const {
    dialog: mirrorDialog,
    pluginOptions: mirrorOptions
  } = useMirrorDialog({
    enabled: !isTestFallback,
    search: searchMirrorCandidatesForDialog,
    onApply: handleMirrorCandidate,
    onCancel: cancelMirrorDialog
  });

  const activeRowEdgeId = activeRow?.edgeId ?? null;
  const activeRowVisibleChildCount = activeRow?.visibleChildCount ?? 0;
  const activeRowAncestorEdgeIds = activeRow?.ancestorEdgeIds ?? [];

  const outlineKeymapRuntimeRef = useRef<OutlineKeymapRuntimeState>({
    commandContext: { outline, origin: localOrigin },
    selectionAdapter,
    activeRowEdgeId,
    activeRowAncestorEdgeIds,
    activeRowVisibleChildCount,
    nextVisibleEdgeId,
    previousVisibleEdgeId,
    onDeleteSelection: onDeleteSelection ?? null,
    onAppendEdge: onAppendEdge ?? null
  });
  outlineKeymapRuntimeRef.current = {
    commandContext: { outline, origin: localOrigin },
    selectionAdapter,
    activeRowEdgeId,
    activeRowAncestorEdgeIds,
    activeRowVisibleChildCount,
    nextVisibleEdgeId,
    previousVisibleEdgeId,
    onDeleteSelection: onDeleteSelection ?? null,
    onAppendEdge: onAppendEdge ?? null
  };

  const resolveSiblingEdgeSelection = (runtime: OutlineKeymapRuntimeState, canonicalEdgeId: EdgeId): EdgeId => {
    const ancestors = runtime.activeRowAncestorEdgeIds;
    if (!ancestors || ancestors.length === 0) {
      return canonicalEdgeId;
    }
    const parentEdgeId = ancestors[ancestors.length - 1] ?? null;
    return projectEdgeIdForParent(outlineSnapshot, parentEdgeId, canonicalEdgeId);
  };

  const resolveChildEdgeSelection = (runtime: OutlineKeymapRuntimeState, canonicalEdgeId: EdgeId): EdgeId => {
    const parentEdgeId = runtime.activeRowEdgeId;
    if (!parentEdgeId) {
      return canonicalEdgeId;
    }
    return projectEdgeIdForParent(outlineSnapshot, parentEdgeId, canonicalEdgeId);
  };

  const outlineKeymapHandlersRef = useRef<OutlineKeymapHandlers | null>(null);
  if (!outlineKeymapHandlersRef.current) {
    outlineKeymapHandlersRef.current = {
      indent: () => {
        const runtime = outlineKeymapRuntimeRef.current;
        const primary = runtime.selectionAdapter.getPrimaryEdgeId();
        const edgeIds = collectOrderedEdgeIds(runtime.selectionAdapter);
        if (edgeIds.length === 0) {
          return false;
        }
        const preserveRange = edgeIds.length > 1;
        const results = indentEdges(runtime.commandContext, [...edgeIds].reverse());
        if (!results) {
          return false;
        }
        const fallback = results[results.length - 1]?.edgeId ?? null;
        resetSelection(runtime.selectionAdapter, primary ?? fallback, { preserveRange });
        return true;
      },
      outdent: () => {
        const runtime = outlineKeymapRuntimeRef.current;
        const primary = runtime.selectionAdapter.getPrimaryEdgeId();
        const edgeIds = collectOrderedEdgeIds(runtime.selectionAdapter);
        if (edgeIds.length === 0) {
          return false;
        }
        const preserveRange = edgeIds.length > 1;
        const results = outdentEdges(runtime.commandContext, edgeIds);
        if (!results) {
          return false;
        }
        const fallback = results[0]?.edgeId ?? null;
        resetSelection(runtime.selectionAdapter, primary ?? fallback, { preserveRange });
        return true;
      },
      insertSibling: ({ state }) => {
        const runtime = outlineKeymapRuntimeRef.current;
        const primary = runtime.selectionAdapter.getPrimaryEdgeId();
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
        const outlineDoc = runtime.commandContext.outline;
        const origin = runtime.commandContext.origin;
        const edgeSnapshot = getEdgeSnapshot(outlineDoc, primary);
        const targetNodeId = edgeSnapshot.childNodeId;
        const childEdgeIds = getChildEdgeIds(outlineDoc, targetNodeId);
        const hasChildren = childEdgeIds.length > 0;
        const visibleChildCount =
          runtime.activeRowEdgeId === primary ? runtime.activeRowVisibleChildCount : 0;
        const isExpanded = hasChildren && visibleChildCount > 0;

        if (!atStart && !atEnd) {
          setNodeText(outlineDoc, targetNodeId, textBefore, origin);
          const result = insertSiblingBelow(runtime.commandContext, primary);
          if (textAfter.length > 0) {
            setNodeText(outlineDoc, result.nodeId, textAfter, origin);
          }
          runtime.onAppendEdge?.(result.edgeId);
          const projectedEdgeId = resolveSiblingEdgeSelection(runtime, result.edgeId);
          resetSelection(runtime.selectionAdapter, projectedEdgeId, { cursor: "start" });
          return true;
        }

        if (atStart && !atEnd) {
          const result = insertSiblingAbove(runtime.commandContext, primary);
          runtime.onAppendEdge?.(result.edgeId);
          const projectedEdgeId = resolveSiblingEdgeSelection(runtime, result.edgeId);
          resetSelection(runtime.selectionAdapter, projectedEdgeId, { cursor: "start" });
          return true;
        }

        if (atEnd) {
          if (isExpanded) {
            const childResult = insertChildAtStart(runtime.commandContext, primary);
            runtime.onAppendEdge?.(childResult.edgeId);
            const projectedEdgeId = resolveChildEdgeSelection(runtime, childResult.edgeId);
            resetSelection(runtime.selectionAdapter, projectedEdgeId, { cursor: "start" });
            return true;
          }
          const result = insertSiblingBelow(runtime.commandContext, primary);
          runtime.onAppendEdge?.(result.edgeId);
          const projectedEdgeId = resolveSiblingEdgeSelection(runtime, result.edgeId);
          resetSelection(runtime.selectionAdapter, projectedEdgeId, { cursor: "start" });
          return true;
        }

        return false;
      },
      insertChild: () => {
        const runtime = outlineKeymapRuntimeRef.current;
        const primary = runtime.selectionAdapter.getPrimaryEdgeId();
        if (!primary) {
          return false;
        }
        const result = insertChild(runtime.commandContext, primary);
        runtime.onAppendEdge?.(result.edgeId);
        const projectedEdgeId = resolveChildEdgeSelection(runtime, result.edgeId);
        resetSelection(runtime.selectionAdapter, projectedEdgeId, { cursor: "start" });
        return true;
      },
      mergeWithPrevious: ({ state }) => {
        const runtime = outlineKeymapRuntimeRef.current;
        const primary = runtime.selectionAdapter.getPrimaryEdgeId();
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

        const mergeResult = mergeWithPrevious(runtime.commandContext, primary);
        if (!mergeResult) {
          return false;
        }

        const projectedEdgeId = resolveSiblingEdgeSelection(runtime, mergeResult.edgeId);
        resetSelection(runtime.selectionAdapter, projectedEdgeId, {
          cursor: mergeResult.cursor
        });
        return true;
      },
      deleteSelection: () => {
        const runtime = outlineKeymapRuntimeRef.current;
        if (!runtime.onDeleteSelection) {
          return false;
        }
        return runtime.onDeleteSelection();
      },
      toggleDone: () => {
        const runtime = outlineKeymapRuntimeRef.current;
        const edgeIds = collectOrderedEdgeIds(runtime.selectionAdapter);
        if (edgeIds.length === 0) {
          return false;
        }
        const result = toggleTodoDoneCommand(runtime.commandContext, edgeIds);
        return result !== null;
      },
      arrowDown: ({ state, dispatch }) => {
        const runtime = outlineKeymapRuntimeRef.current;
        const selection = state.selection;
        if (!selection.empty) {
          return false;
        }
        const parent = selection.$from.parent;
        const atEnd = selection.$from.parentOffset === parent.content.size;
        if (!atEnd) {
          if (!dispatch) {
            return false;
          }
          const endSelection = Selection.atEnd(state.doc);
          if (!selection.eq(endSelection)) {
            dispatch(state.tr.setSelection(endSelection));
            return true;
          }
        }
        if (!runtime.nextVisibleEdgeId) {
          return false;
        }
        resetSelection(runtime.selectionAdapter, runtime.nextVisibleEdgeId, { cursor: "end" });
        return true;
      },
      arrowUp: ({ state, dispatch }) => {
        const runtime = outlineKeymapRuntimeRef.current;
        const selection = state.selection;
        if (!selection.empty) {
          return false;
        }
        const atStart = selection.$from.parentOffset === 0;
        if (!atStart) {
          if (!dispatch) {
            return false;
          }
          const startSelection = Selection.atStart(state.doc);
          if (!selection.eq(startSelection)) {
            dispatch(state.tr.setSelection(startSelection));
            return true;
          }
        }
        if (!runtime.previousVisibleEdgeId) {
          return false;
        }
        resetSelection(runtime.selectionAdapter, runtime.previousVisibleEdgeId, {
          cursor: "start"
        });
        return true;
      }
    } satisfies OutlineKeymapHandlers;
  }

  const outlineKeymapOptions = useMemo<OutlineKeymapOptions>(
    () => ({ handlers: outlineKeymapHandlersRef.current! }),
    []
  );

  const outlineKeymapOptionsRef = useRef(outlineKeymapOptions);
  outlineKeymapOptionsRef.current = outlineKeymapOptions;

  const handleWikiLinkActivate = useCallback<NonNullable<EditorWikiLinkOptions["onActivate"]>>(
    ({ nodeId: targetId }) => {
      if (!onWikiLinkNavigate) {
        return;
      }
      if (typeof targetId !== "string") {
        return;
      }
      onWikiLinkNavigate(targetId as NodeId);
    },
    [onWikiLinkNavigate]
  );

  const handleWikiLinkHover = useCallback<NonNullable<EditorWikiLinkOptions["onHover"]>>(
    ({ type, element, nodeId: targetId, view }) => {
      if (!onWikiLinkHover || !activeRow) {
        return;
      }
      if (typeof targetId !== "string") {
        return;
      }
      const segmentIndex = findWikiLinkSegmentIndex(
        view,
        element,
        activeRow.inlineContent,
        targetId as NodeId
      );
      if (type === "enter" && segmentIndex < 0) {
        return;
      }
      const fallbackText = element.textContent ?? "";
      const displayText =
        segmentIndex >= 0 ? activeRow.inlineContent[segmentIndex]?.text ?? fallbackText : fallbackText;
      onWikiLinkHover({
        type,
        edgeId: activeRow.edgeId,
        sourceNodeId: activeRow.nodeId,
        targetNodeId: targetId as NodeId,
        displayText,
        segmentIndex,
        element
      });
    },
    [activeRow, onWikiLinkHover]
  );

  const wikiLinkHandlers = useMemo<EditorWikiLinkOptions | null>(() => {
    if (!wikiLinkOptions) {
      return null;
    }
    return {
      ...wikiLinkOptions,
      onActivate: handleWikiLinkActivate,
      onHover: handleWikiLinkHover
    };
  }, [handleWikiLinkActivate, handleWikiLinkHover, wikiLinkOptions]);

  const wikiLinkHandlersRef = useRef(wikiLinkHandlers);
  wikiLinkHandlersRef.current = wikiLinkHandlers;

  const mirrorOptionsRef = useRef<EditorMirrorOptions | null>(mirrorOptions);
  mirrorOptionsRef.current = mirrorOptions ?? null;

  const appliedOutlineKeymapOptionsRef = useRef<OutlineKeymapOptions | null>(null);
  const appliedWikiLinkHandlersRef = useRef<EditorWikiLinkOptions | null>(null);
  const appliedMirrorOptionsRef = useRef<EditorMirrorOptions | null>(null);

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
        outlineKeymapOptions: outlineKeymapOptionsRef.current,
        wikiLinkOptions: wikiLinkHandlersRef.current,
        mirrorOptions: mirrorOptionsRef.current
      });
      editorRef.current = editor;
      if ((globalThis as { __THORTIQ_PROSEMIRROR_TEST__?: boolean }).__THORTIQ_PROSEMIRROR_TEST__) {
        (globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__ = editor;
      }
      appliedOutlineKeymapOptionsRef.current = outlineKeymapOptionsRef.current;
      appliedWikiLinkHandlersRef.current = wikiLinkHandlersRef.current;
      appliedMirrorOptionsRef.current = mirrorOptionsRef.current;
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
    if (isTestFallback) {
      return;
    }
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    if (appliedOutlineKeymapOptionsRef.current !== outlineKeymapOptionsRef.current) {
      editor.setOutlineKeymapOptions(outlineKeymapOptionsRef.current);
      appliedOutlineKeymapOptionsRef.current = outlineKeymapOptionsRef.current;
    }
    if (appliedWikiLinkHandlersRef.current !== wikiLinkHandlersRef.current) {
      editor.setWikiLinkOptions(wikiLinkHandlersRef.current);
      appliedWikiLinkHandlersRef.current = wikiLinkHandlersRef.current;
    }
    if (appliedMirrorOptionsRef.current !== mirrorOptionsRef.current) {
      editor.setMirrorOptions(mirrorOptionsRef.current);
      appliedMirrorOptionsRef.current = mirrorOptionsRef.current;
    }
  }, [isTestFallback, mirrorOptions, outlineKeymapOptions, wikiLinkHandlers]);

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
  if (!wikiDialog && !mirrorDialog) {
    return null;
  }

  return (
    <>
      {wikiDialog ? (
        <WikiLinkDialog
          anchor={wikiDialog.anchor}
          query={wikiDialog.query}
          results={wikiDialog.results}
          selectedIndex={wikiDialog.selectedIndex}
          onSelect={wikiDialog.select}
          onHoverIndexChange={wikiDialog.setHoverIndex}
          onRequestClose={wikiDialog.close}
        />
      ) : null}
      {mirrorDialog ? (
        <MirrorDialog
          anchor={mirrorDialog.anchor}
          query={mirrorDialog.query}
          results={mirrorDialog.results}
          selectedIndex={mirrorDialog.selectedIndex}
          onSelect={mirrorDialog.select}
          onHoverIndexChange={mirrorDialog.setHoverIndex}
          onRequestClose={mirrorDialog.close}
        />
      ) : null}
    </>
  );
};


