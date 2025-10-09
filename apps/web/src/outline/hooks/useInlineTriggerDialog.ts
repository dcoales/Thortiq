import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "prosemirror-view";

export interface InlineTriggerPayload {
  readonly query: string;
  readonly anchor: {
    readonly left: number;
    readonly bottom: number;
  };
}

export interface InlineTriggerDialogRenderState<TCandidate> {
  readonly anchor: InlineTriggerPayload["anchor"];
  readonly query: InlineTriggerPayload["query"];
  readonly results: ReadonlyArray<TCandidate>;
  readonly selectedIndex: number;
  readonly select: (candidate: TCandidate) => void;
  readonly setHoverIndex: (index: number) => void;
  readonly close: () => void;
}

interface InternalDialogState {
  readonly payload: InlineTriggerPayload;
}

export interface TriggerEventBase {
  readonly view: EditorView;
  readonly trigger: {
    readonly query: string;
    readonly from: number;
    readonly to: number;
  };
}

export interface TriggerPluginHandlers<TEvent> {
  readonly onStateChange: (event: TEvent | null) => void;
  readonly onKeyDown: (event: KeyboardEvent, context: TEvent) => boolean;
}

export type TriggerPluginOptionsShape<TEvent> = Partial<TriggerPluginHandlers<TEvent>>;

export interface InlineTriggerDialogPluginHelpers<
  TCandidate,
  TEvent extends TriggerEventBase
> {
  readonly getActiveEvent: () => TEvent | null;
  readonly getResults: () => ReadonlyArray<TCandidate>;
  readonly applyCandidate: (candidate: TCandidate) => void;
  readonly closeDialog: () => void;
}

export interface UseInlineTriggerDialogParams<TCandidate, TEvent extends TriggerEventBase> {
  readonly enabled: boolean;
  readonly search: (query: string, context: { readonly event: TEvent | null }) => ReadonlyArray<TCandidate>;
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

export const useInlineTriggerDialog = <
  TCandidate,
  TEvent extends TriggerEventBase,
  TPluginOptions = TriggerPluginOptionsShape<TEvent>
>(
  params: UseInlineTriggerDialogParams<TCandidate, TEvent>,
  createPluginOptions?: (
    handlers: TriggerPluginHandlers<TEvent>,
    helpers: InlineTriggerDialogPluginHelpers<TCandidate, TEvent>
  ) => TPluginOptions
): {
  readonly dialog: InlineTriggerDialogRenderState<TCandidate> | null;
  readonly pluginOptions: TPluginOptions | null;
  readonly activeEvent: TEvent | null;
} => {
  const { enabled, search, onApply, onCancel } = params;
  const [dialogState, setDialogState] = useState<InternalDialogState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeEvent, setActiveEvent] = useState<TEvent | null>(null);

  const activeEventRef = useRef(activeEvent);
  activeEventRef.current = activeEvent;

  const dialogStateRef = useRef(dialogState);
  dialogStateRef.current = dialogState;

  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const resultsRef = useRef<ReadonlyArray<TCandidate>>([]);

  useEffect(() => {
    if (!dialogState) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((current) => clampIndex(current, resultsRef.current.length));
  }, [dialogState, activeEvent]);

  useEffect(() => {
    if (enabled) {
      return;
    }
    if (!dialogStateRef.current) {
      return;
    }
    onCancel?.();
    setDialogState(null);
    setActiveEvent(null);
    setSelectedIndex(0);
  }, [enabled, onCancel]);

  const closeDialog = useCallback(() => {
    if (!enabledRef.current) {
      return;
    }
    onCancel?.();
    setDialogState(null);
    setActiveEvent(null);
    setSelectedIndex(0);
  }, [onCancel]);

  const applyCandidate = useCallback(
    (candidate: TCandidate) => {
      const result = onApply(candidate);
      if (result === false) {
        return;
      }
      setDialogState(null);
      setActiveEvent(null);
      setSelectedIndex(0);
    },
    [onApply]
  );

  const pluginHelpers = useMemo<InlineTriggerDialogPluginHelpers<TCandidate, TEvent>>(
    () => ({
      getActiveEvent: () => activeEventRef.current,
      getResults: () => resultsRef.current,
      applyCandidate: (candidate: TCandidate) => {
        applyCandidate(candidate);
      },
      closeDialog: () => {
        closeDialog();
      }
    }),
    [applyCandidate, closeDialog]
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

  const handleStateChange = useCallback<TriggerPluginHandlers<TEvent>["onStateChange"]>(
    (payload) => {
      if (!enabledRef.current) {
        return;
      }
      if (!payload) {
        setDialogState(null);
        setActiveEvent(null);
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
      setActiveEvent(payload);
      setDialogState({
        payload: {
          query: payload.trigger.query,
          anchor: {
            left,
            bottom
          }
        }
      });
    },
    []
  );

  const handleKeyDown = useCallback<TriggerPluginHandlers<TEvent>["onKeyDown"]>(
    (event, _context) => {
      void _context;
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

  const defaultCreatePluginOptions = useCallback(
    (
      handlers: TriggerPluginHandlers<TEvent>,
      _helpers: InlineTriggerDialogPluginHelpers<TCandidate, TEvent>
    ) => {
      void _helpers;
      return {
        onStateChange: handlers.onStateChange,
        onKeyDown: handlers.onKeyDown
      } as unknown as TPluginOptions;
    },
    []
  );

  const pluginOptions = useMemo<TPluginOptions | null>(() => {
    if (!enabled) {
      return null;
    }
    const factory = createPluginOptions ?? defaultCreatePluginOptions;
    return factory({
      onStateChange: handleStateChange,
      onKeyDown: handleKeyDown
    }, pluginHelpers);
  }, [
    createPluginOptions,
    defaultCreatePluginOptions,
    enabled,
    handleKeyDown,
    handleStateChange,
    pluginHelpers
  ]);

  const deferredQuery = useDeferredValue(dialogState?.payload.query ?? "");

  const dialog: InlineTriggerDialogRenderState<TCandidate> | null = useMemo(() => {
    if (!dialogState || !enabled) {
      return null;
    }
    const results = search(deferredQuery, { event: activeEvent });
    resultsRef.current = results;
    const clampedSelected = clampIndex(selectedIndex, results.length);
    selectedIndexRef.current = clampedSelected;
    return {
      anchor: dialogState.payload.anchor,
      query: dialogState.payload.query,
      results,
      selectedIndex: clampedSelected,
      select: applyCandidate,
      setHoverIndex,
      close: closeDialog
    };
  }, [activeEvent, applyCandidate, closeDialog, deferredQuery, dialogState, enabled, search, selectedIndex, setHoverIndex]);

  return {
    dialog,
    pluginOptions,
    activeEvent
  };
};
