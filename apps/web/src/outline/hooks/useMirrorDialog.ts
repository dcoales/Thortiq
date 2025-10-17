import { useInlineTriggerDialog } from "./useInlineTriggerDialog";
import type { InlineTriggerDialogRenderState } from "./useInlineTriggerDialog";
import type { EditorMirrorOptions, MirrorTriggerEvent } from "@thortiq/editor-prosemirror";
import type { MirrorDialogCandidate } from "../components/MirrorDialog";

export interface UseMirrorDialogParams {
  readonly enabled: boolean;
  readonly search: (query: string) => ReadonlyArray<MirrorDialogCandidate>;
  readonly onApply: (candidate: MirrorDialogCandidate) => boolean | void;
  readonly onCancel?: () => void;
}

export interface UseMirrorDialogResult {
  readonly dialog: InlineTriggerDialogRenderState<MirrorDialogCandidate> | null;
  readonly pluginOptions: EditorMirrorOptions | null;
}

export const useMirrorDialog = (params: UseMirrorDialogParams): UseMirrorDialogResult => {
  const { enabled, search, onApply, onCancel } = params;
  return useInlineTriggerDialog<MirrorDialogCandidate, MirrorTriggerEvent, EditorMirrorOptions>(
    {
      enabled,
      search,
      onApply,
      onCancel
    }
  );
};
