import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  EditorWikiLinkOptions as EditorInlineTriggerOptions,
  WikiLinkTriggerEvent as InlineTriggerEvent
} from "@thortiq/editor-prosemirror";

export interface InlineTriggerDialogRenderState<TCandidate> {
  readonly anchor: {
    readonly left: number;
    readonly bottom: number;
  };
  readonly query: string;
  readonly results: ReadonlyArray<TCandidate>;
  readonly selectedIndex: number;
  readonly select: (candidate: TCandidate) => void;
  readonly setHoverIndex: (index: number) => void;
  readonly close: () => void;
}

interface InternalDialogState {
  readonly query: string;
  readonly anchor: {
    readonly left: number;
    readonly bottom: number;
  };
}

export interface UseInlineTriggerDialogParams<TCandidate> {
  readonly enabled: boolean;
  readonly search: (query: string) => ReadonlyArray<TCandidate>;
  readonly onApply: (candidate: TCandidate) => boolean | void;
  readonly onCancel?: () => void;
}

const clampIndex = (index: number, length: number): number => {
  if (length <= 0) {
    return 0;
  }
  if (index < 0) {
    return 0;
  }
  if (index >= length) {
    return length - 1;
  }
  return index;
};

export const useInlineTriggerDialog = <TCandidate,>(
  params: UseInlineTriggerDialogParams<TCandidate>
): {
  readonly dialog: InlineTriggerDialogRenderState<TCandidate> | null;
  readonly pluginOptions: EditorInlineTriggerOptions | null;
} => {
  const { enabled, search, onApply, onCancel } = params;
  const [dialogState, setDialogState] = useState<InternalDialogState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const dialogStateRef = useRef(dialogState);
  dialogStateRef.current = dialogState;

  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const results = useMemo<ReadonlyArray<TCandidate>>(() => {
    if (!enabled || !dialogState) {
      return [];
    }
    return search(dialogState.query);
  }, [dialogState, enabled, search]);

  const resultsRef = useRef(results);
  resultsRef.current = results;

  useEffect(() => {
    if (!dialogState) {
      setSelectedIndex(0);
      return;
    }
    if (results.length === 0) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((current) => clampIndex(current, results.length));
  }, [dialogState, results.length]);

  useEffect(() => {
    if (enabled) {
      return;
    }
    if (!dialogStateRef.current) {
      return;
    }
    onCancel?.();
    setDialogState(null);
    setSelectedIndex(0);
  }, [enabled, onCancel]);

  const closeDialog = useCallback(() => {
    if (!enabledRef.current) {
      return;
    }
    onCancel?.();
    setDialogState(null);
    setSelectedIndex(0);
  }, [onCancel]);

  const applyCandidate = useCallback(
    (candidate: TCandidate) => {
      const result = onApply(candidate);
      if (result === false) {
        return;
      }
      setDialogState(null);
      setSelectedIndex(0);
    },
    [onApply]
  );

  const setHoverIndex = useCallback((index: number) => {
    setSelectedIndex((current) => {
      const length = resultsRef.current.length;
      if (length === 0) {
        return 0;
      }
      if (index === current) {
        return current;
      }
      return clampIndex(index, length);
    });
  }, []);

  const handleStateChange = useCallback<NonNullable<EditorInlineTriggerOptions["onStateChange"]>>(
    (payload) => {
      if (!enabledRef.current) {
        return;
      }
      if (!payload) {
        setDialogState(null);
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
      setDialogState({
        query: payload.trigger.query,
        anchor: {
          left,
          bottom
        }
      });
    },
    []
  );

  const handleKeyDown = useCallback<NonNullable<EditorInlineTriggerOptions["onKeyDown"]>>(
    (event: KeyboardEvent) => {
      if (!dialogStateRef.current) {
        return false;
      }

      const length = resultsRef.current.length;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = clampIndex(selectedIndexRef.current + 1, length);
        setSelectedIndex(next);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const next = clampIndex(selectedIndexRef.current - 1, length);
        setSelectedIndex(next);
        return true;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const currentResults = resultsRef.current;
        if (currentResults.length === 0) {
          return true;
        }
        const candidate =
          currentResults[clampIndex(selectedIndexRef.current, currentResults.length)] ?? currentResults[0];
        if (candidate) {
          applyCandidate(candidate);
        }
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return true;
      }
      return false;
    },
    [applyCandidate, closeDialog]
  );

  const dialog = useMemo<InlineTriggerDialogRenderState<TCandidate> | null>(() => {
    if (!dialogState || !enabled) {
      return null;
    }
    return {
      anchor: dialogState.anchor,
      query: dialogState.query,
      results,
      selectedIndex,
      select: applyCandidate,
      setHoverIndex,
      close: closeDialog
    };
  }, [applyCandidate, closeDialog, dialogState, enabled, results, selectedIndex, setHoverIndex]);

  const pluginOptions = useMemo<EditorInlineTriggerOptions | null>(() => {
    if (!enabled) {
      return null;
    }
    return {
      onStateChange: handleStateChange,
      onKeyDown: handleKeyDown
    };
  }, [enabled, handleKeyDown, handleStateChange]);

  return {
    dialog,
    pluginOptions
  };
};
