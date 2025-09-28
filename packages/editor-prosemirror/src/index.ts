/**
 * Thin placeholder for upcoming ProseMirror integration hooks. Phase 1 keeps the API small
 * so the web app can import a stable contract once editor wiring lands.
 */
export interface EditorBootstrap {
  readonly placeholder: string;
}

export const createEditorPlaceholder = (): EditorBootstrap => ({
  placeholder: "prosemirror-editor-pending"
});
