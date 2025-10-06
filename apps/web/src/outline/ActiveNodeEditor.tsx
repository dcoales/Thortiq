import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Selection, TextSelection } from "prosemirror-state";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";

import {
  getChildEdgeIds,
  getEdgeSnapshot,
  getTagBackgroundColor,
  searchWikiLinkCandidates,
  setNodeText,
  syncTagsFromFragment,
  type EdgeId,
  type InlineSpan,
  type OutlineSnapshot,
  type WikiLinkSearchCandidate
} from "@thortiq/client-core";
import type { NodeId } from "@thortiq/sync-core";
import { createCollaborativeEditor } from "@thortiq/editor-prosemirror";
import type {
  CollaborativeEditor,
  EditorTagOptions,
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
import { TagDialog } from "./components/TagDialog";

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

interface WikiDialogState {
  readonly query: string;
  readonly anchor: {
    readonly left: number;
    readonly bottom: number;
  };
}

interface TagDialogState {
  readonly query: string;
  readonly triggerChar: "#" | "@";
  readonly anchor: {
    readonly left: number;
    readonly bottom: number;
  };
}

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
  activeRowVisibleChildCount: number;
  activeRowAncestorEdgeIds: ReadonlyArray<EdgeId>;
  activeRowIsSearchPartial: boolean;
  nextVisibleEdgeId: EdgeId | null;
  previousVisibleEdgeId: EdgeId | null;
  onDeleteSelection: (() => boolean) | null;
  ensureEdgeVisible: ((edgeId: EdgeId, ancestorEdgeIds: ReadonlyArray<EdgeId>) => void) | null;
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
  readonly nodeId: NodeId;
  readonly inlineContent: ReadonlyArray<InlineSpan>;
  readonly hasChildren: boolean;
  readonly collapsed: boolean;
  readonly visibleChildCount: number;
  readonly ancestorEdgeIds: ReadonlyArray<EdgeId>;
  readonly search?: {
    readonly isMatch: boolean;
    readonly isPartial: boolean;
  };
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
  readonly onTagClick?: (tagName: string) => void;
  readonly ensureEdgeVisible?: (edgeId: EdgeId, ancestorEdgeIds: ReadonlyArray<EdgeId>) => void;
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
  onTagClick,
  ensureEdgeVisible
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
  const [wikiDialogState, setWikiDialogState] = useState<WikiDialogState | null>(null);
  const [wikiSelectionIndex, setWikiSelectionIndex] = useState(0);
  const [tagDialogState, setTagDialogState] = useState<TagDialogState | null>(null);
  const [tagSelectionIndex, setTagSelectionIndex] = useState(0);

  const activeRowEdgeId = activeRow?.edgeId ?? null;
  const activeRowVisibleChildCount = activeRow?.visibleChildCount ?? 0;
  const activeRowAncestorEdgeIds = activeRow?.ancestorEdgeIds ?? [];
  const activeRowIsSearchPartial = Boolean(activeRow?.search?.isPartial);

  const outlineKeymapRuntimeRef = useRef<OutlineKeymapRuntimeState>({
    commandContext: { outline, origin: localOrigin },
    selectionAdapter,
    activeRowEdgeId,
    activeRowVisibleChildCount,
    activeRowAncestorEdgeIds,
    activeRowIsSearchPartial,
    nextVisibleEdgeId,
    previousVisibleEdgeId,
    onDeleteSelection: onDeleteSelection ?? null,
    ensureEdgeVisible: ensureEdgeVisible ?? null
  });
  outlineKeymapRuntimeRef.current = {
    commandContext: { outline, origin: localOrigin },
    selectionAdapter,
    activeRowEdgeId,
    activeRowVisibleChildCount,
    activeRowAncestorEdgeIds,
    activeRowIsSearchPartial,
    nextVisibleEdgeId,
    previousVisibleEdgeId,
    onDeleteSelection: onDeleteSelection ?? null,
    ensureEdgeVisible: ensureEdgeVisible ?? null
  } satisfies OutlineKeymapRuntimeState;

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
        const isPrimaryRow = runtime.activeRowEdgeId === primary;
        const visibleChildCount = isPrimaryRow ? runtime.activeRowVisibleChildCount : 0;
        const isPartialParent = isPrimaryRow ? runtime.activeRowIsSearchPartial : false;
        const isExpanded = hasChildren && (visibleChildCount > 0 || isPartialParent);
        const ensureEdgeVisible = runtime.ensureEdgeVisible;
        const baseAncestors = isPrimaryRow ? runtime.activeRowAncestorEdgeIds : [];

        if (!atStart && !atEnd) {
          setNodeText(outlineDoc, targetNodeId, textBefore, origin);
          const result = insertSiblingBelow(runtime.commandContext, primary);
          if (textAfter.length > 0) {
            setNodeText(outlineDoc, result.nodeId, textAfter, origin);
          }
          if (ensureEdgeVisible) {
            ensureEdgeVisible(result.edgeId, baseAncestors);
          }
          resetSelection(runtime.selectionAdapter, result.edgeId, { cursor: "start" });
          return true;
        }

        if (atStart && !atEnd) {
          const result = insertSiblingAbove(runtime.commandContext, primary);
          if (ensureEdgeVisible) {
            ensureEdgeVisible(result.edgeId, baseAncestors);
          }
          resetSelection(runtime.selectionAdapter, result.edgeId, { cursor: "start" });
          return true;
        }

        if (atEnd) {
          if (isExpanded) {
            const childResult = insertChildAtStart(runtime.commandContext, primary);
            if (ensureEdgeVisible) {
              const childAncestors = isPrimaryRow
                ? [...runtime.activeRowAncestorEdgeIds, primary]
                : [primary];
              ensureEdgeVisible(childResult.edgeId, childAncestors);
            }
            resetSelection(runtime.selectionAdapter, childResult.edgeId, { cursor: "start" });
            return true;
          }
          const result = insertSiblingBelow(runtime.commandContext, primary);
          if (ensureEdgeVisible) {
            ensureEdgeVisible(result.edgeId, baseAncestors);
          }
          resetSelection(runtime.selectionAdapter, result.edgeId, { cursor: "start" });
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
        if (runtime.ensureEdgeVisible) {
          const childAncestors = runtime.activeRowEdgeId === primary
            ? [...runtime.activeRowAncestorEdgeIds, primary]
            : [primary];
          runtime.ensureEdgeVisible(result.edgeId, childAncestors);
        }
        resetSelection(runtime.selectionAdapter, result.edgeId, { cursor: "start" });
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

        resetSelection(runtime.selectionAdapter, mergeResult.edgeId, {
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

  const wikiSearchCandidates = useMemo<WikiLinkSearchCandidate[]>(() => {
    if (!wikiDialogState) {
      return [];
    }
    return searchWikiLinkCandidates(outlineSnapshot, wikiDialogState.query, {
      excludeNodeId: nodeId ?? undefined
    });
  }, [outlineSnapshot, wikiDialogState, nodeId]);

  useEffect(() => {
    if (!wikiDialogState) {
      setWikiSelectionIndex(0);
    }
  }, [wikiDialogState]);

  useEffect(() => {
    if (wikiSearchCandidates.length === 0) {
      setWikiSelectionIndex(0);
      return;
    }
    setWikiSelectionIndex((current) => {
      if (current < 0) {
        return 0;
      }
      if (current >= wikiSearchCandidates.length) {
        return wikiSearchCandidates.length - 1;
      }
      return current;
    });
  }, [wikiSearchCandidates.length]);

  const handleWikiLinkStateChange = useCallback<NonNullable<EditorWikiLinkOptions["onStateChange"]>>(
    (payload) => {
      if (!payload) {
        setWikiDialogState(null);
        return;
      }
      let left = 0;
      let bottom = 0;
      try {
        const coords = payload.view.coordsAtPos(payload.trigger.to);
        left = coords.left;
        bottom = coords.bottom;
      } catch {
        left = 0;
        bottom = 0;
      }
      setWikiDialogState({
        query: payload.trigger.query,
        anchor: { left, bottom }
      });
    },
    []
  );

  const applyWikiCandidate = useCallback(
    (candidate: WikiLinkSearchCandidate) => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }
      const displayText = candidate.text.length > 0 ? candidate.text : "Untitled node";
      editor.applyWikiLink({
        targetNodeId: candidate.nodeId,
        displayText
      });
      setWikiDialogState(null);
      setWikiSelectionIndex(0);
    },
    []
  );

  const handleWikiLinkKeyDown = useCallback<NonNullable<EditorWikiLinkOptions["onKeyDown"]>>(
    (event) => {
      if (!wikiDialogState) {
        return false;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setWikiSelectionIndex((current) => {
          if (wikiSearchCandidates.length === 0) {
            return 0;
          }
          const next = current + 1;
          return next >= wikiSearchCandidates.length ? wikiSearchCandidates.length - 1 : next;
        });
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setWikiSelectionIndex((current) => {
          const next = current - 1;
          return next < 0 ? 0 : next;
        });
        return true;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const candidate = wikiSearchCandidates[wikiSelectionIndex] ?? wikiSearchCandidates[0];
        if (candidate) {
          applyWikiCandidate(candidate);
        }
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        editorRef.current?.cancelWikiLink();
        setWikiDialogState(null);
        return true;
      }
      return false;
    },
    [wikiDialogState, wikiSearchCandidates, wikiSelectionIndex, applyWikiCandidate]
  );

  const handleWikiLinkActivate = useCallback<NonNullable<EditorWikiLinkOptions["onActivate"]>>(
    ({ nodeId }) => {
      if (!onWikiLinkNavigate) {
        return;
      }
      onWikiLinkNavigate(nodeId as NodeId);
    },
    [onWikiLinkNavigate]
  );

  const handleWikiLinkHover = useCallback<NonNullable<EditorWikiLinkOptions["onHover"]>>(
    ({ type, element, nodeId, view }) => {
      if (!onWikiLinkHover || !activeRow) {
        return;
      }
      if (typeof nodeId !== "string") {
        return;
      }
      const inlineContent = activeRow.inlineContent;
      const targetNodeId = nodeId as NodeId;
      const segmentIndex = findWikiLinkSegmentIndex(view, element, inlineContent, targetNodeId);
      if (type === "enter" && segmentIndex < 0) {
        return;
      }
      const fallbackText = element.textContent ?? "";
      const displayText = segmentIndex >= 0 ? inlineContent[segmentIndex]?.text ?? fallbackText : fallbackText;
      onWikiLinkHover({
        type,
        edgeId: activeRow.edgeId,
        sourceNodeId: activeRow.nodeId,
        targetNodeId,
        displayText,
        segmentIndex,
        element
      });
    },
    [activeRow, onWikiLinkHover]
  );

  const wikiLinkHandlers = useMemo<EditorWikiLinkOptions>(
    () => ({
      onStateChange: handleWikiLinkStateChange,
      onKeyDown: handleWikiLinkKeyDown,
      onActivate: handleWikiLinkActivate,
      onHover: handleWikiLinkHover
    }),
    [handleWikiLinkActivate, handleWikiLinkHover, handleWikiLinkKeyDown, handleWikiLinkStateChange]
  );

  // Collect all existing tags from the outline with their last used timestamp
  const existingTags = useMemo(() => {
    const tagMap = new Map<string, number>(); // tag -> most recent updatedAt
    for (const node of outlineSnapshot.nodes.values()) {
      for (const tag of node.metadata.tags) {
        const existing = tagMap.get(tag);
        if (!existing || node.metadata.updatedAt > existing) {
          tagMap.set(tag, node.metadata.updatedAt);
        }
      }
    }
    // Sort by most recent usage (newest first)
    return Array.from(tagMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }, [outlineSnapshot]);

  useEffect(() => {
    if (!tagDialogState) {
      setTagSelectionIndex(0);
    }
  }, [tagDialogState]);

  const handleTagStateChange = useCallback<NonNullable<EditorTagOptions["onStateChange"]>>(
    (payload) => {
      if (!payload) {
        setTagDialogState(null);
        return;
      }
      let left = 0;
      let bottom = 0;
      const coords = payload.view.coordsAtPos(payload.trigger.from);
      if (coords) {
        left = coords.left;
        bottom = coords.bottom;
      } else {
        left = 0;
        bottom = 0;
      }
      setTagDialogState({
        query: payload.trigger.query,
        triggerChar: payload.trigger.triggerChar,
        anchor: { left, bottom }
      });
    },
    []
  );

  const applyTagCandidate = useCallback(
    (tagName: string) => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }
      const color = getTagBackgroundColor(tagName);
      const success = editor.applyTag({ name: tagName, color });
      
      if (success && nodeId) {
        // Sync tags to metadata immediately
        syncTagsFromFragment(outline, nodeId, localOrigin);
      }
      
      setTagDialogState(null);
      setTagSelectionIndex(0);
    },
    [localOrigin, nodeId, outline]
  );

  const handleTagKeyDown = useCallback<NonNullable<EditorTagOptions["onKeyDown"]>>(
    (event) => {
      if (!tagDialogState) {
        return false;
      }
      const triggerChar = tagDialogState.triggerChar;
      const lowerQuery = tagDialogState.query.toLowerCase();
      
      // Filter tags matching trigger character and query
      const filteredTags = existingTags.filter((tag) => {
        if (!tag.startsWith(triggerChar)) {
          return false;
        }
        if (tagDialogState.query.length === 0) {
          return true;
        }
        const tagName = tag.substring(1);
        return tagName.toLowerCase().includes(lowerQuery);
      });
      
      // Add current query as "create new" option only when no matches exist
      const fullTag = triggerChar + tagDialogState.query;
      if (tagDialogState.query.length > 0 && filteredTags.length === 0) {
        filteredTags.push(fullTag);
      }
      
      if (event.key === " ") {
        // Space key: create tag with whatever user has typed
        event.preventDefault();
        if (tagDialogState.query.length > 0) {
          applyTagCandidate(tagDialogState.query);
        }
        return true;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setTagSelectionIndex((prev) => {
          const newIndex = Math.min(prev + 1, filteredTags.length - 1);
          return newIndex >= 0 ? newIndex : 0;
        });
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setTagSelectionIndex((prev) => Math.max(prev - 1, 0));
        return true;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (filteredTags.length > 0 && tagSelectionIndex < filteredTags.length) {
          const selectedTag = filteredTags[tagSelectionIndex];
          const tagName = selectedTag.substring(1); // Remove trigger character
          applyTagCandidate(tagName);
        } else if (tagDialogState.query.length > 0) {
          // Create new tag with current query
          applyTagCandidate(tagDialogState.query);
        }
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        editorRef.current?.cancelTag();
        setTagDialogState(null);
        return true;
      }
      return false;
    },
    [tagDialogState, existingTags, tagSelectionIndex, applyTagCandidate]
  );

  const handleTagClick = useCallback<NonNullable<EditorTagOptions["onClick"]>>(
    ({ tagName }) => {
      onTagClick?.(tagName);
    },
    [onTagClick]
  );

  const tagHandlers = useMemo<EditorTagOptions>(
    () => ({
      onStateChange: handleTagStateChange,
      onKeyDown: handleTagKeyDown,
      onClick: handleTagClick
    }),
    [handleTagClick, handleTagKeyDown, handleTagStateChange]
  );

  const outlineKeymapOptionsRef = useRef(outlineKeymapOptions);
  outlineKeymapOptionsRef.current = outlineKeymapOptions;
  const wikiLinkHandlersRef = useRef(wikiLinkHandlers);
  wikiLinkHandlersRef.current = wikiLinkHandlers;
  const tagHandlersRef = useRef(tagHandlers);
  tagHandlersRef.current = tagHandlers;
  const appliedOutlineKeymapOptionsRef = useRef<OutlineKeymapOptions | null>(null);
  const appliedWikiLinkHandlersRef = useRef<EditorWikiLinkOptions | null>(null);
  const appliedTagHandlersRef = useRef<EditorTagOptions | null>(null);

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
        tagOptions: tagHandlersRef.current
      });
      editorRef.current = editor;
      if ((globalThis as { __THORTIQ_PROSEMIRROR_TEST__?: boolean }).__THORTIQ_PROSEMIRROR_TEST__) {
        (globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__ = editor;
      }
      appliedOutlineKeymapOptionsRef.current = outlineKeymapOptionsRef.current;
      appliedWikiLinkHandlersRef.current = wikiLinkHandlersRef.current;
      appliedTagHandlersRef.current = tagHandlersRef.current;
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
    if (appliedOutlineKeymapOptionsRef.current !== outlineKeymapOptions) {
      editor.setOutlineKeymapOptions(outlineKeymapOptions);
      appliedOutlineKeymapOptionsRef.current = outlineKeymapOptions;
    }
    if (appliedWikiLinkHandlersRef.current !== wikiLinkHandlers) {
      editor.setWikiLinkOptions(wikiLinkHandlers);
      appliedWikiLinkHandlersRef.current = wikiLinkHandlers;
    }
    if (appliedTagHandlersRef.current !== tagHandlers) {
      editor.setTagOptions(tagHandlers);
      appliedTagHandlersRef.current = tagHandlers;
    }
  }, [isTestFallback, outlineKeymapOptions, tagHandlers, wikiLinkHandlers]);

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
  const handleWikiHoverIndexChange = useCallback((index: number) => {
    setWikiSelectionIndex(index);
  }, []);

  const handleTagHoverIndexChange = useCallback((index: number) => {
    setTagSelectionIndex(index);
  }, []);

  return (
    <>
      {wikiDialogState && (
        <WikiLinkDialog
          anchor={wikiDialogState.anchor}
          query={wikiDialogState.query}
          results={wikiSearchCandidates}
          selectedIndex={wikiSelectionIndex}
          onSelect={applyWikiCandidate}
          onHoverIndexChange={handleWikiHoverIndexChange}
          onRequestClose={() => {
            editorRef.current?.cancelWikiLink();
            setWikiDialogState(null);
          }}
        />
      )}
      {tagDialogState && (
        <TagDialog
          anchor={tagDialogState.anchor}
          query={tagDialogState.query}
          triggerChar={tagDialogState.triggerChar}
          existingTags={existingTags}
          selectedIndex={tagSelectionIndex}
          onSelect={applyTagCandidate}
          onHoverIndexChange={handleTagHoverIndexChange}
          onRequestClose={() => {
            editorRef.current?.cancelTag();
            setTagDialogState(null);
          }}
        />
      )}
    </>
  );
};
