import { useCallback, useMemo, useState } from "react";
import type { EdgeId, NodeId, OutlineDoc } from "@thortiq/client-core";
import { DatePickerPopover } from "../outline/components/DatePickerPopover";
import { parseIsoDate } from "./format";

export interface InlineDateClickPayload {
  readonly edgeId: EdgeId;
  readonly nodeId: NodeId;
  readonly displayText: string;
  readonly segmentIndex: number | null;
  readonly value: string | null;
  readonly hasTime: boolean;
  readonly anchor: { readonly left: number; readonly top: number; readonly bottom: number };
  readonly position?: { readonly from: number; readonly to: number } | null;
}

interface UseInlineDatePickerOptions {
  readonly outline: OutlineDoc;
  readonly onSelectDate: (edgeId: EdgeId, nodeId: NodeId, date: Date, hasTime: boolean) => void;
}

export const useInlineDatePicker = ({ outline, onSelectDate }: UseInlineDatePickerOptions) => {
  void outline; // outline reserved for future formatting-aware defaults
  const [state, setState] = useState<{
    edgeId: EdgeId;
    nodeId: NodeId;
    hasTime: boolean;
    value: string | null;
    anchor: { readonly left: number; readonly top: number; readonly bottom: number };
  } | null>(null);

  const open = useCallback((payload: InlineDateClickPayload) => {
    setState({
      edgeId: payload.edgeId,
      nodeId: payload.nodeId,
      hasTime: payload.hasTime,
      value: payload.value ?? null,
      anchor: payload.anchor
    });
  }, []);

  const close = useCallback(() => setState(null), []);

  const node = useMemo(() => {
    if (!state) {
      return null;
    }
    return (
      <DatePickerPopover
        anchor={state.anchor}
        value={parseIsoDate(state.value)}
        onSelect={(date) => {
          onSelectDate(state.edgeId, state.nodeId, date, state.hasTime);
          setState(null);
        }}
        onClose={() => setState(null)}
      />
    );
  }, [onSelectDate, state]);

  return { datePickerNode: node, openDatePicker: open, closeDatePicker: close } as const;
};


