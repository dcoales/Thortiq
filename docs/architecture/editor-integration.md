# ProseMirror Integration

Phase 1 mounts a single ProseMirror editor on the active outline row while every other row stays
rendered as static HTML. The heavy lifting lives in `@thortiq/editor-prosemirror` so platforms can
adopt the same behaviour without duplicating wiring.

## Collaboration stack

- The editor operates on the per-node `Y.XmlFragment` stored under `textXml`. When a node is
  selected we build an `EditorState` with `ySyncPlugin(fragment)`, `yCursorPlugin(awareness)` and
  `yUndoPlugin({ undoManager })`, guaranteeing all edits flow through the same Yjs transaction
  pipeline as structural changes.
- The shared `UndoManager` from `@thortiq/sync-core` is passed into the plugin so text and outline
  operations land in a unified undo history.
- Awareness state is hydrated once (name + colour) to power remote caret rendering.

## React binding

`ActiveNodeEditor` owns the editor lifecycle. It keeps a single `EditorView` instance alive for the
app session, updates it when selection changes, and reuses the same DOM host to honour the
“seamless switching” requirement—there’s no flicker because React never remounts the view. The hook
backs off in test mode so Vitest can assert rendering without spinning up ProseMirror.

## Preview harness

`apps/web/preview.html` boots a lightweight QA surface backed by the new `OutlineProvider` overrides.
Each scenario uses ephemeral persistence/providers so mutations stay in-memory while still flowing
through Yjs transactions. Use `pnpm preview` to inspect collapsed branches, deep hierarchies, and
presence indicators without touching the live sync server.

## Virtualised rows

Only the selected row mounts the editable view. TanStack Virtual still measures the same container
element, so row height remains accurate whether we’re rendering static text or the ProseMirror DOM.
Other rows stay pure spans, which keeps scroll performance high even with hundreds of thousands of
nodes.

## Plain text snapshot

`createOutlineSnapshot()` still exposes a plain string per node. It flattens the XML fragment into
newline-separated paragraphs, trims redundant trailing newlines, and produces immutable snapshots so
React components never hold live Yjs references. This also means non-editor surfaces (search,
virtual list, mobile read-only mode) can continue to render without loading ProseMirror.

## Extending

- New formatting marks or block types should be added to `editorSchema` and, if they affect plain
  text rendering, reflected in the `xmlElementToText` helper.
- Platform-specific editor chrome (toolbars, slash commands, etc.) should import
  `createCollaborativeEditor` instead of talking to ProseMirror directly to keep logic shared-first.
- Structural commands (insert, indent, collapse) live in `@thortiq/outline-commands`. UI layers
  should call those helpers rather than mutating Yjs structures directly so keyboard bindings stay
  consistent across platforms.
