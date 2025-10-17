import type { CollaborativeEditor } from "@thortiq/editor-prosemirror";
import type { NodeId } from "@thortiq/sync-core";

/**
 * Shared manager for the single collaborative editor instance used across outline panes. This keeps
 * AGENTS rule #20 intact by letting panes hand over the active container without spawning extra
 * ProseMirror views.
 */
interface SharedEditorRecord {
  editor: CollaborativeEditor;
  ownerPaneId: string | null;
  lastNodeId: NodeId | null;
  awarenessIndicatorsEnabled: boolean;
  debugLoggingEnabled: boolean;
}

interface AcquireSharedEditorOptions {
  readonly paneId: string;
  readonly container: HTMLDivElement;
  readonly nodeId: NodeId;
  readonly awarenessIndicatorsEnabled: boolean;
  readonly debugLoggingEnabled: boolean;
  readonly createEditor: (container: HTMLDivElement, nodeId: NodeId) => CollaborativeEditor;
}

export interface AcquireSharedEditorResult {
  readonly editor: CollaborativeEditor;
  readonly created: boolean;
}

let sharedRecord: SharedEditorRecord | null = null;
let mountCount = 0;

const destroySharedEditor = (): CollaborativeEditor | null => {
  if (!sharedRecord) {
    return null;
  }
  const { editor } = sharedRecord;
  editor.destroy();
  sharedRecord = null;
  return editor;
};

export const acquireSharedEditor = (
  options: AcquireSharedEditorOptions
): AcquireSharedEditorResult => {
  if (
    sharedRecord
    && (
      sharedRecord.awarenessIndicatorsEnabled !== options.awarenessIndicatorsEnabled
      || sharedRecord.debugLoggingEnabled !== options.debugLoggingEnabled
    )
  ) {
    destroySharedEditor();
  }

  if (!sharedRecord) {
    const editor = options.createEditor(options.container, options.nodeId);
    sharedRecord = {
      editor,
      ownerPaneId: options.paneId,
      lastNodeId: options.nodeId,
      awarenessIndicatorsEnabled: options.awarenessIndicatorsEnabled,
      debugLoggingEnabled: options.debugLoggingEnabled
    };
    return { editor, created: true };
  }

  sharedRecord.ownerPaneId = options.paneId;
  sharedRecord.awarenessIndicatorsEnabled = options.awarenessIndicatorsEnabled;
  sharedRecord.debugLoggingEnabled = options.debugLoggingEnabled;
  sharedRecord.editor.setContainer(options.container);
  if (sharedRecord.lastNodeId !== options.nodeId) {
    sharedRecord.editor.setNode(options.nodeId);
    sharedRecord.lastNodeId = options.nodeId;
  }
  return { editor: sharedRecord.editor, created: false };
};

export const detachSharedEditor = (paneId: string, host: HTMLDivElement): void => {
  if (!sharedRecord) {
    return;
  }
  if (sharedRecord.ownerPaneId !== paneId) {
    return;
  }
  sharedRecord.editor.setContainer(host);
  sharedRecord.ownerPaneId = null;
};

export const registerEditorMount = (): void => {
  mountCount += 1;
};

export const registerEditorUnmount = (paneId: string): CollaborativeEditor | null => {
  mountCount = Math.max(0, mountCount - 1);
  if (sharedRecord && sharedRecord.ownerPaneId === paneId) {
    sharedRecord.ownerPaneId = null;
  }
  if (mountCount === 0) {
    return destroySharedEditor();
  }
  return null;
};

export const resetSharedEditorForTests = (): void => {
  mountCount = 0;
  destroySharedEditor();
};

export const getSharedEditorOwner = (): string | null =>
  sharedRecord?.ownerPaneId ?? null;
