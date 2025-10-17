import { useMemo, useState, useEffect, useCallback } from "react";

import {
  normalizeTagId,
  selectTagsByCreatedAt,
  type OutlineDoc,
  type TagRegistryEntry,
  type TagTrigger
} from "@thortiq/client-core";
import type { EditorTagOptions, TagTriggerEvent } from "@thortiq/editor-prosemirror";

import {
  useInlineTriggerDialog,
  type InlineTriggerDialogPluginHelpers,
  type InlineTriggerDialogRenderState,
  type TriggerPluginHandlers
} from "./useInlineTriggerDialog";

export interface TagSuggestion {
  readonly id: string;
  readonly label: string;
  readonly trigger: TagTrigger;
  readonly createdAt: number;
  readonly lastUsedAt: number;
  readonly isNew: boolean;
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

const normalizeLabelWhitespace = (label: string): string => label.trim().replace(/\s+/gu, " ");

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
          lastUsedAt: entry.lastUsedAt,
          isNew: false
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

  const pluginOptionsFactory = useCallback(
    (
      handlers: TriggerPluginHandlers<TagTriggerEvent>,
      helpers: InlineTriggerDialogPluginHelpers<TagSuggestion, TagTriggerEvent>
    ): EditorTagOptions => {
      const resolveNewSuggestion = (
        query: string,
        triggerChar: TagTriggerEvent["trigger"]["triggerChar"]
      ): TagSuggestion | null => {
        const normalizedLabel = normalizeLabelWhitespace(query);
        if (normalizedLabel.length === 0) {
          return null;
        }
        const trigger = (triggerChar === "@" ? "@" : "#") as TagTrigger;
        const id = normalizeTagId(normalizedLabel);
        if (id.length === 0) {
          return null;
        }
        const timestamp = Date.now();
        return {
          id,
          label: normalizedLabel,
          trigger,
          createdAt: timestamp,
          lastUsedAt: timestamp,
          isNew: true
        };
      };

      return {
        onStateChange: handlers.onStateChange,
        onKeyDown: (event: KeyboardEvent, context: TagTriggerEvent) => {
          const { trigger } = context;
          if (event.key === " ") {
            const suggestion = resolveNewSuggestion(trigger.query, trigger.triggerChar);
            if (suggestion) {
              event.preventDefault();
              helpers.applyCandidate(suggestion);
              return true;
            }
          }
          if (event.key === "Enter") {
            const results = helpers.getResults();
            if (results.length === 0) {
              const suggestion = resolveNewSuggestion(trigger.query, trigger.triggerChar);
              if (suggestion) {
                event.preventDefault();
                helpers.applyCandidate(suggestion);
                return true;
              }
            }
          }
          return handlers.onKeyDown ? handlers.onKeyDown(event, context) : false;
        }
      };
    },
    []
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
    pluginOptionsFactory
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
