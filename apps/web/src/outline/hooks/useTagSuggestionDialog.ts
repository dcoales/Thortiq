import { useMemo, useState, useEffect, useCallback } from "react";

import {
  selectTagsByCreatedAt,
  type OutlineDoc,
  type TagRegistryEntry,
  type TagTrigger
} from "@thortiq/client-core";
import type { EditorTagOptions, TagTriggerEvent } from "@thortiq/editor-prosemirror";

import {
  useInlineTriggerDialog,
  type InlineTriggerDialogRenderState
} from "./useInlineTriggerDialog";

export interface TagSuggestion {
  readonly id: string;
  readonly label: string;
  readonly trigger: TagTrigger;
  readonly createdAt: number;
  readonly lastUsedAt: number;
}

export interface TagSuggestionDialogState
  extends InlineTriggerDialogRenderState<TagSuggestion> {
  readonly trigger: TagTrigger;
}

export interface UseTagSuggestionDialogParams {
  readonly enabled: boolean;
  readonly outline: OutlineDoc;
  readonly onApply: (suggestion: TagSuggestion) => boolean | void;
  readonly onCancel?: () => void;
}

const normalize = (value: string): string => value.trim().toLowerCase();

const useTagRegistrySnapshot = (outline: OutlineDoc, revision: number): ReadonlyArray<TagRegistryEntry> => {
  return useMemo(() => {
    void revision;
    return selectTagsByCreatedAt(outline);
  }, [outline, revision]);
};

export const useTagSuggestionDialog = (
  params: UseTagSuggestionDialogParams
): {
  readonly dialog: TagSuggestionDialogState | null;
  readonly pluginOptions: EditorTagOptions | null;
} => {
  const { enabled, outline, onApply, onCancel } = params;
  const [registryRevision, setRegistryRevision] = useState(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const observer = () => {
      setRegistryRevision((current) => current + 1);
    };
    outline.tagRegistry.observe(observer);
    return () => {
      outline.tagRegistry.unobserve(observer);
    };
  }, [enabled, outline]);

  const entries = useTagRegistrySnapshot(outline, registryRevision);

  const indexedSuggestions = useMemo(
    () =>
      entries.map((entry) => ({
        suggestion: {
          id: entry.id,
          label: entry.label,
          trigger: entry.trigger,
          createdAt: entry.createdAt,
          lastUsedAt: entry.lastUsedAt
        },
        normalizedLabel: normalize(entry.label),
        normalizedId: normalize(entry.id)
      })),
    [entries]
  );

  const filterSuggestions = useCallback(
    (query: string, context: { readonly event: TagTriggerEvent | null }): ReadonlyArray<TagSuggestion> => {
      const triggerChar = context.event?.trigger.triggerChar ?? "#";
      const source = indexedSuggestions.filter((item) => item.suggestion.trigger === triggerChar);
      if (query.length === 0) {
        return source.slice(0, 25).map((item) => item.suggestion);
      }
      const normalizedQuery = normalize(query);
      if (normalizedQuery.length === 0) {
        return source.slice(0, 25).map((item) => item.suggestion);
      }
      const matches = source.filter(
        (item) =>
          item.normalizedLabel.includes(normalizedQuery) || item.normalizedId.includes(normalizedQuery)
      );
      return matches.slice(0, 25).map((item) => item.suggestion);
    },
    [indexedSuggestions]
  );

  const { dialog, pluginOptions, activeEvent } = useInlineTriggerDialog<
    TagSuggestion,
    TagTriggerEvent,
    EditorTagOptions
  >(
    {
      enabled,
      search: filterSuggestions,
      onApply,
      onCancel
    },
    ({ onStateChange, onKeyDown }) => ({
      onStateChange,
      onKeyDown
    })
  );

  const augmentedDialog = useMemo<TagSuggestionDialogState | null>(() => {
    if (!dialog || !activeEvent) {
      return null;
    }
    return {
      ...dialog,
      trigger: activeEvent.trigger.triggerChar
    };
  }, [activeEvent, dialog]);

  return {
    dialog: augmentedDialog,
    pluginOptions
  };
};
