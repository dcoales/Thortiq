import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  upsertTagRegistryEntry,
  getColorPalette,
  replaceColorPalette,
  getUserSetting,
  type EdgeId,
  type OutlineSnapshot,
  type InlineSpan,
  type WikiLinkSearchCandidate,
  type TagTrigger,
  type ColorPaletteMode,
  type ColorPaletteSnapshot
} from "@thortiq/client-core";
import type { NodeId } from "@thortiq/sync-core";
import { createCollaborativeEditor } from "@thortiq/editor-prosemirror";
import type {
  CollaborativeEditor,
  EditorMirrorOptions,
  EditorTagOptions,
  EditorTagClickEvent,
  EditorWikiLinkOptions,
  WikiLinkTriggerEvent,
  OutlineSelectionAdapter,
  OutlineCursorPlacement,
  OutlineKeymapOptions,
  OutlineKeymapHandlers,
  DateDetectionOptions,
  DateMarkClickPayload
} from "@thortiq/editor-prosemirror";
import { SelectionFormattingMenu } from "@thortiq/client-react";

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
import type { OutlineDateClickPayload } from "@thortiq/client-react";
import { useInlineTriggerDialog } from "./hooks/useInlineTriggerDialog";
import {
  useTagSuggestionDialog,
  type TagSuggestion
} from "./hooks/useTagSuggestionDialog";
import { useMirrorDialog } from "./hooks/useMirrorDialog";
import {
  projectEdgeIdAfterIndent,
  projectEdgeIdAfterOutdent,
  projectEdgeIdForParent
} from "./utils/projectEdgeId";
import { TagSuggestionDialog } from "./components/TagSuggestionDialog";
import { InlineTriggerDialog } from "./components/InlineTriggerDialog";
import {
  acquireSharedEditor,
  detachSharedEditor,
  registerEditorMount,
  registerEditorUnmount
} from "./sharedCollaborativeEditor";

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
  readonly paneId: string;
  readonly isActive: boolean;
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
  readonly onTagClick?: (payload: { readonly label: string; readonly trigger: TagTrigger }) => void;
  readonly onEditorInstanceChange?: (editor: CollaborativeEditor | null) => void;
  readonly onDateClick?: (payload: OutlineDateClickPayload) => void;
}

const shouldUseEditorFallback = (): boolean => {
  if (import.meta.env?.MODE !== "test") {
    return false;
  }
  const flag = (globalThis as { __THORTIQ_PROSEMIRROR_TEST__?: boolean }).__THORTIQ_PROSEMIRROR_TEST__;
  return !flag;
};
export const ActiveNodeEditor = ({
  paneId,
  isActive,
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
  onAppendEdge,
  onTagClick,
  onEditorInstanceChange,
  onDateClick
}: ActiveNodeEditorProps): JSX.Element | null => {
  const { outline, awareness, undoManager, localOrigin } = useSyncContext();
  const awarenessIndicatorsEnabled = useAwarenessIndicatorsEnabled();
  const syncDebugLoggingEnabled = useSyncDebugLoggingEnabled();
  const isTestFallback = shouldUseEditorFallback();
  const editorRef = useRef<CollaborativeEditor | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPaletteSnapshot>(() => getColorPalette(outline));

  useEffect(() => {
    if (isTestFallback) {
      return;
    }
    const preferences = outline.userPreferences;
    const handlePreferencesChange = () => {
      setColorPalette(getColorPalette(outline));
    };
    preferences.observe(handlePreferencesChange);
    return () => {
      preferences.unobserve(handlePreferencesChange);
    };
  }, [outline, isTestFallback]);

  const persistColorPalette = useCallback(
    (mode: ColorPaletteMode, swatches: ReadonlyArray<string>) => {
      const next = replaceColorPalette(outline, mode, swatches, { origin: localOrigin });
      setColorPalette(next);
    },
    [outline, localOrigin]
  );
  const [formattingEditor, setFormattingEditor] = useState<CollaborativeEditor | null>(null);
  const [detectedDate, setDetectedDate] = useState<{
    date: Date;
    text: string;
    position: { from: number; to: number };
  } | null>(null);
  const [dateAnchor, setDateAnchor] = useState<{ left: number; bottom: number } | null>(null);

  const activeRowEdgeId = activeRow?.edgeId ?? null;
  const activeRowVisibleChildCount = activeRow?.visibleChildCount ?? 0;
  const activeRowAncestorEdgeIds = activeRow?.ancestorEdgeIds ?? [];

  // Intercept Tab to confirm date when the date popup is open
  useEffect(() => {
    if (!detectedDate) {
      return;
    }
    const findRangeNearCaret = (): { from: number; to: number } | null => {
      const editor = editorRef.current;
      if (!editor) return null;
      const { view } = editor;
      const head = view.state.selection.head;
      const windowStart = Math.max(0, head - 100);
      const windowEnd = Math.min(view.state.doc.content.size, head + 100);
      const windowText = view.state.doc.textBetween(windowStart, windowEnd, "\n", "\n");
      const needle = detectedDate.text;
      let bestFrom: number | null = null;
      const headOffset = head - windowStart;
      let idx = windowText.indexOf(needle);
      while (idx >= 0) {
        const end = idx + needle.length;
        if (end >= headOffset - 1 && end <= headOffset + 1) {
          bestFrom = windowStart + idx;
          break;
        }
        bestFrom = windowStart + idx; // fallback to last occurrence
        idx = windowText.indexOf(needle, idx + 1);
      }
      if (bestFrom == null) return null;
      return { from: bestFrom, to: bestFrom + needle.length };
    };
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const editor = editorRef.current;
      if (!editor) {
        setDetectedDate(null);
        setDateAnchor(null);
        return;
      }
      const hasTime = /\b(\d{1,2}:\d{2}|\d{1,2}\s?(am|pm)|at\s+\d)/i.test(detectedDate.text);
      const userFormat = getUserSetting(outline, "datePillFormat") as string;
      const format = userFormat || "ddd, MMM D";
      const options: Intl.DateTimeFormatOptions = {
        weekday: format.includes("ddd") ? "short" : undefined,
        month: format.includes("MMM") ? "short" : undefined,
        day: format.includes("D") ? "numeric" : undefined,
        hour: hasTime && format.includes("h") ? "numeric" : undefined,
        minute: hasTime && format.includes("mm") ? "2-digit" : undefined,
        hour12: format.includes("a") ? true : undefined
      };
      const displayText = new Intl.DateTimeFormat("en-US", options).format(detectedDate.date);
      const baseRange = findRangeNearCaret() ?? detectedDate.position;
      const docSize = editor.view.state.doc.content.size;
      const adjustedRange = { from: baseRange.from, to: Math.min(docSize, baseRange.to + 1) };
      editor.applyDateTag(detectedDate.date, displayText, hasTime, adjustedRange);
      setDetectedDate(null);
      setDateAnchor(null);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => {
      window.removeEventListener("keydown", handler, true);
    };
  }, [detectedDate, outline]);
  const lastNodeIdRef = useRef<NodeId | null>(null);
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
  } = useInlineTriggerDialog<WikiLinkSearchCandidate, WikiLinkTriggerEvent, EditorWikiLinkOptions>(
    {
      enabled: !isTestFallback,
      search: searchInlineCandidates,
      onApply: applyWikiCandidate,
      onCancel: cancelWikiDialog
    }
  );

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

  const handleTagCandidate = useCallback(
    (suggestion: TagSuggestion) => {
      const editor = editorRef.current;
      if (!editor) {
        return false;
      }
      let tagId = suggestion.id;
      let tagLabel = suggestion.label;
      if (suggestion.isNew) {
        try {
          const entry = upsertTagRegistryEntry(outline, {
            label: suggestion.label,
            trigger: suggestion.trigger
          });
          tagId = entry.id;
          tagLabel = entry.label;
        } catch (error) {
          if (typeof console !== "undefined" && typeof console.error === "function") {
            console.error("[ActiveNodeEditor] failed to create tag", error);
          }
          editor.focus();
          return false;
        }
      }
      let applied = false;
      try {
        applied = editor.applyTag({
          id: tagId,
          label: tagLabel,
          trigger: suggestion.trigger
        });
      } catch (error) {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("[ActiveNodeEditor] tag apply failed", error);
        }
        applied = false;
      }
      if (!applied) {
        editor.focus();
      }
      return applied;
    },
    [outline]
  );

  const cancelTagDialog = useCallback(() => {
    editorRef.current?.cancelTagTrigger();
  }, []);

  const { dialog: tagDialog, pluginOptions: tagPluginOptions } = useTagSuggestionDialog({
    enabled: !isTestFallback,
    outline,
    onApply: handleTagCandidate,
    onCancel: cancelTagDialog
  });

  const handleEditorTagClick = useCallback(
    (event: EditorTagClickEvent) => {
      if (!onTagClick) {
        return;
      }
      const normalizedLabel = event.label.trim();
      if (normalizedLabel.length === 0) {
        return;
      }
      const trigger: TagTrigger = event.trigger === "@" ? "@" : "#";
      onTagClick({
        label: normalizedLabel,
        trigger
      });
    },
    [onTagClick]
  );

  const effectiveTagOptions = useMemo<EditorTagOptions | null>(() => {
    if (!tagPluginOptions && !onTagClick) {
      return tagPluginOptions ?? null;
    }
    if (!onTagClick) {
      return tagPluginOptions ?? null;
    }
    if (!tagPluginOptions) {
      return { onTagClick: handleEditorTagClick };
    }
    return {
      ...tagPluginOptions,
      onTagClick: handleEditorTagClick
    };
  }, [handleEditorTagClick, onTagClick, tagPluginOptions]);

  const effectiveDateOptions = useMemo<DateDetectionOptions | null>(() => {
    let baseOptions: DateDetectionOptions = {
      getUserDateFormat: () => {
        const datePillFormat = getUserSetting(outline, "datePillFormat") as string;
        return datePillFormat || "ddd, MMM D";
      },
      onDateDetected: (date: Date, text: string, position: { from: number; to: number }) => {
        setDetectedDate({ date, text, position });
        const editor = editorRef.current;
        if (editor) {
          try {
            const coords = editor.view.coordsAtPos(position.to);
            setDateAnchor({ left: coords.left, bottom: coords.bottom });
          } catch {
            setDateAnchor(null);
          }
        } else {
          setDateAnchor(null);
        }
      },
      onDetectionCleared: () => {
        setDetectedDate(null);
        setDateAnchor(null);
      },
      onDateConfirmed: (date: Date, text: string, position: { from: number; to: number }) => {
        // Apply date tag
        if (editorRef.current) {
          const hasTime = text.toLowerCase().includes('am') || text.toLowerCase().includes('pm') || 
                         text.includes(':') || text.toLowerCase().includes('at');
          const userFormat = getUserSetting(outline, "datePillFormat") as string;
          const format = userFormat || "ddd, MMM D";
          
          // Format the date for display
          const options: Intl.DateTimeFormatOptions = {
            weekday: format.includes('ddd') ? 'short' : undefined,
            month: format.includes('MMM') ? 'short' : undefined,
            day: format.includes('D') ? 'numeric' : undefined,
            hour: hasTime && format.includes('h') ? 'numeric' : undefined,
            minute: hasTime && format.includes('mm') ? '2-digit' : undefined,
            hour12: format.includes('a') ? true : undefined,
          };
          
          const displayText = new Intl.DateTimeFormat('en-US', options).format(date);
          editorRef.current.applyDateTag(date, displayText, hasTime, position);
        }
        setDetectedDate(null);
        setDateAnchor(null);
      }
    };

    if (onDateClick && nodeId && activeRowEdgeId) {
      baseOptions = {
        ...baseOptions,
        onDateMarkClick: ({
          rect,
          attrs,
          from,
          to
        }: DateMarkClickPayload) => {
          const anchor = {
            left: rect.left + rect.width / 2,
            top: rect.top,
            bottom: rect.bottom
          };
          onDateClick({
            edgeId: activeRowEdgeId,
            sourceNodeId: nodeId,
            segmentIndex: null,
            value: attrs.date,
            displayText: attrs.displayText,
            hasTime: attrs.hasTime,
            anchor,
            position: { from, to }
          });
        }
      };
    }

    return baseOptions;
  }, [activeRowEdgeId, nodeId, onDateClick, outline]);

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
        const canonicalTarget = primary ?? fallback ?? null;
        const ancestorEdgeIds = runtime.activeRowAncestorEdgeIds;
        const parentEdgeId =
          ancestorEdgeIds.length > 0 ? ancestorEdgeIds[ancestorEdgeIds.length - 1] ?? null : null;
        const projectedEdgeId = projectEdgeIdAfterIndent(outlineSnapshot, {
          currentEdgeId: runtime.activeRowEdgeId,
          currentParentEdgeId: parentEdgeId,
          canonicalEdgeId: canonicalTarget
        });
        resetSelection(runtime.selectionAdapter, projectedEdgeId, { preserveRange });
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
        const canonicalTarget = primary ?? fallback ?? null;
        const ancestorEdgeIds = runtime.activeRowAncestorEdgeIds;
        const newParentEdgeId =
          ancestorEdgeIds.length > 1 ? ancestorEdgeIds[ancestorEdgeIds.length - 2] ?? null : null;
        const projectedEdgeId = projectEdgeIdAfterOutdent(outlineSnapshot, {
          canonicalEdgeId: canonicalTarget,
          newParentEdgeId
        });
        resetSelection(runtime.selectionAdapter, projectedEdgeId, { preserveRange });
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

  const tagOptionsRef = useRef<EditorTagOptions | null>(effectiveTagOptions);
  tagOptionsRef.current = effectiveTagOptions ?? null;
  const dateOptionsRef = useRef<DateDetectionOptions | null>(effectiveDateOptions);
  dateOptionsRef.current = effectiveDateOptions ?? null;

  const appliedOutlineKeymapOptionsRef = useRef<OutlineKeymapOptions | null>(null);
  const appliedWikiLinkHandlersRef = useRef<EditorWikiLinkOptions | null>(null);
  const appliedMirrorOptionsRef = useRef<EditorMirrorOptions | null>(null);
  const appliedTagOptionsRef = useRef<EditorTagOptions | null>(null);
  const appliedDateOptionsRef = useRef<DateDetectionOptions | null>(null);

  useEffect(() => {
    if (isTestFallback) {
      return;
    }
    registerEditorMount();
    return () => {
      if (isTestFallback) {
        return;
      }
      detachSharedEditor(paneId, detachedHost);
      const destroyedEditor = registerEditorUnmount(paneId);
      if (destroyedEditor && (globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__ === destroyedEditor) {
        delete (globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__;
      }
      editorRef.current = null;
      lastNodeIdRef.current = null;
      setFormattingEditor(null);
      onEditorInstanceChange?.(null);
    };
  }, [detachedHost, isTestFallback, onEditorInstanceChange, paneId]);

  useLayoutEffect(() => {
    if (isTestFallback) {
      return;
    }
    if (!isActive || !container || !nodeId) {
      detachSharedEditor(paneId, detachedHost);
      editorRef.current = null;
      lastNodeIdRef.current = null;
      setFormattingEditor(null);
      onEditorInstanceChange?.(null);
      return;
    }

    const { editor, created } = acquireSharedEditor({
      paneId,
      container,
      nodeId,
      awarenessIndicatorsEnabled,
      debugLoggingEnabled: syncDebugLoggingEnabled,
      createEditor: (targetContainer, targetNodeId) =>
        createCollaborativeEditor({
          container: targetContainer,
          outline,
          awareness,
          undoManager,
          localOrigin,
          nodeId: targetNodeId,
          awarenessIndicatorsEnabled,
          awarenessDebugLoggingEnabled: awarenessIndicatorsEnabled && syncDebugLoggingEnabled,
          debugLoggingEnabled: syncDebugLoggingEnabled,
          outlineKeymapOptions: outlineKeymapOptionsRef.current,
          wikiLinkOptions: wikiLinkHandlersRef.current,
          mirrorOptions: mirrorOptionsRef.current,
          tagOptions: tagOptionsRef.current,
          dateOptions: dateOptionsRef.current
        })
    });

    editorRef.current = editor;
    if (created) {
      appliedOutlineKeymapOptionsRef.current = outlineKeymapOptionsRef.current;
      appliedWikiLinkHandlersRef.current = wikiLinkHandlersRef.current;
      appliedMirrorOptionsRef.current = mirrorOptionsRef.current;
      appliedTagOptionsRef.current = tagOptionsRef.current;
      appliedDateOptionsRef.current = dateOptionsRef.current;
      if ((globalThis as { __THORTIQ_PROSEMIRROR_TEST__?: boolean }).__THORTIQ_PROSEMIRROR_TEST__) {
        (globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__ = editor;
      }
    }
    if (lastNodeIdRef.current !== nodeId) {
      editor.setNode(nodeId);
    }
    lastNodeIdRef.current = nodeId;
    editor.focus();
    setFormattingEditor((current) => (current === editor ? current : editor));
    onEditorInstanceChange?.(editor);

    return () => {
      detachSharedEditor(paneId, detachedHost);
      editorRef.current = null;
    };
  }, [
    awareness,
    awarenessIndicatorsEnabled,
    container,
    detachedHost,
    isActive,
    isTestFallback,
    localOrigin,
    nodeId,
    outline,
    paneId,
    syncDebugLoggingEnabled,
    undoManager,
    onEditorInstanceChange
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
    if (appliedTagOptionsRef.current !== tagOptionsRef.current) {
      editor.setTagOptions(tagOptionsRef.current);
      appliedTagOptionsRef.current = tagOptionsRef.current;
    }
    if (appliedDateOptionsRef.current !== dateOptionsRef.current) {
      editor.setDateOptions(dateOptionsRef.current);
      appliedDateOptionsRef.current = dateOptionsRef.current;
    }
  }, [effectiveTagOptions, effectiveDateOptions, isTestFallback, mirrorOptions, outlineKeymapOptions, wikiLinkHandlers]);

  useEffect(() => {
    if (!isTestFallback) {
      return;
    }
    if (pendingCursor) {
      onPendingCursorHandled?.();
    }
  }, [isTestFallback, onPendingCursorHandled, pendingCursor]);

  useEffect(() => {
    if (!isTestFallback) {
      return;
    }
    onEditorInstanceChange?.(null);
  }, [isTestFallback, onEditorInstanceChange]);

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
  const shouldShowFormattingMenu = !isTestFallback && Boolean(formattingEditor);
  if (!shouldShowFormattingMenu && !wikiDialog && !mirrorDialog && !tagDialog) {
    return null;
  }

  return (
    <>
      {shouldShowFormattingMenu ? (
        <SelectionFormattingMenu
          editor={formattingEditor}
          colorPalette={colorPalette}
          onUpdateColorPalette={persistColorPalette}
        />
      ) : null}
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
      {tagDialog ? (
        <TagSuggestionDialog
          anchor={tagDialog.anchor}
          query={tagDialog.query}
          results={tagDialog.results}
          selectedIndex={tagDialog.selectedIndex}
          onSelect={tagDialog.select}
          onHoverIndexChange={tagDialog.setHoverIndex}
          onRequestClose={tagDialog.close}
        />
      ) : null}
      {detectedDate && dateAnchor ? (
        <InlineTriggerDialog
          anchor={dateAnchor}
          query={detectedDate.text}
          results={[{ text: detectedDate.text, date: detectedDate.date }]}
          selectedIndex={0}
          getPrimaryText={(item: { text: string; date: Date }) => item.text}
          getSecondaryText={(item: { text: string; date: Date }) => item.date.toLocaleString()}
          onSelect={() => {
            const editor = editorRef.current;
            if (!editor) {
              setDetectedDate(null);
              setDateAnchor(null);
              return;
            }
            const hasTime = detectedDate.text.toLowerCase().includes('am') ||
              detectedDate.text.toLowerCase().includes('pm') ||
              detectedDate.text.includes(':') ||
              detectedDate.text.toLowerCase().includes('at');
            const userFormat = getUserSetting(outline, "datePillFormat") as string;
            const format = userFormat || "ddd, MMM D";
            const options: Intl.DateTimeFormatOptions = {
              weekday: format.includes('ddd') ? 'short' : undefined,
              month: format.includes('MMM') ? 'short' : undefined,
              day: format.includes('D') ? 'numeric' : undefined,
              hour: hasTime && format.includes('h') ? 'numeric' : undefined,
              minute: hasTime && format.includes('mm') ? '2-digit' : undefined,
              hour12: format.includes('a') ? true : undefined
            };
            const displayText = new Intl.DateTimeFormat('en-US', options).format(detectedDate.date);
            // Recompute the range near the caret to avoid stale start/end
            const { view } = editor;
            const head = view.state.selection.head;
            const windowStart = Math.max(0, head - 100);
            const windowEnd = Math.min(view.state.doc.content.size, head + 100);
            const windowText = view.state.doc.textBetween(windowStart, windowEnd, "\n", "\n");
            const needle = detectedDate.text;
            let bestFrom: number | null = null;
            const headOffset = head - windowStart;
            let idx = windowText.indexOf(needle);
            while (idx >= 0) {
              const end = idx + needle.length;
              if (end >= headOffset - 1 && end <= headOffset + 1) {
                bestFrom = windowStart + idx;
                break;
              }
              bestFrom = windowStart + idx;
              idx = windowText.indexOf(needle, idx + 1);
            }
            const base = bestFrom != null ? { from: bestFrom, to: bestFrom + needle.length } : detectedDate.position;
            const docSize = view.state.doc.content.size;
            const adjusted = { from: base.from, to: Math.min(docSize, base.to + 1) };
            editor.applyDateTag(detectedDate.date, displayText, hasTime, adjusted);
            setDetectedDate(null);
            setDateAnchor(null);
          }}
          onRequestClose={() => {
            setDetectedDate(null);
            setDateAnchor(null);
          }}
          ariaLabel="Date suggestion"
          getItemKey={(_, index) => `date-${index}`}
        />
      ) : null}
    </>
  );
};
