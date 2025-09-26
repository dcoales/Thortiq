# Wiki Links Audit (Step 1)

Scope: Review current inline text, attributes, and undo flows to inform the Wiki Links feature. No runtime changes.

## Inline Text Flow

- Text source: per-node Yjs `Y.Text` bound via `useNodeText` hook which observes and transacts updates.
  - Hook reads/writes inside `doc.transact(..., LOCAL_ORIGIN)` and replaces the text range on update to keep diffs simple.
  - Reference: packages/client-core/src/hooks/useNodeText.ts:9, packages/client-core/src/hooks/useNodeText.ts:25
- Editor binding: `NodeEditor` uses the hook value as a controlled `<textarea>` and avoids DOM mutations while typing.
  - Reference: packages/client-core/src/components/NodeEditor.tsx:44, packages/client-core/src/components/NodeEditor.tsx:344
- Persisting HTML: On blur and at specific structural boundaries, `NodeEditor` commits HTML to the node record via command bus (update-node). HTML is derived from plain text.
  - Reference: packages/client-core/src/components/NodeEditor.tsx:73, packages/client-core/src/components/NodeEditor.tsx:282

## Attributes & HTML Metadata

- Node metadata lives on `NodeRecord` (`html`, `tags`, `attributes`, optional `task`).
  - Reference: packages/client-core/src/types.ts:24
- Updates flow through `CommandBus.applyUpdateNode`, which merges a patch and mirrors `html` into `Y.Text` as plain text to keep sources in sync.
  - Reference: packages/client-core/src/commands/commandBus.ts:51, packages/client-core/src/commands/commandBus.ts:82

## Undo/Redo & Origins

- Undo manager: single `Y.UndoManager` scoped to nodes, edges, sessions, and nodeTexts; it dynamically adds new `Y.Array` and `Y.Text` instances to scope.
  - Reference: packages/client-core/src/yjs/undo.ts:79, packages/client-core/src/yjs/undo.ts:12
- Tracked origins: only `LOCAL_ORIGIN` is tracked; remote/selection changes are excluded from the undo stack.
  - Reference: packages/client-core/src/yjs/undo.ts:21, packages/client-core/src/yjs/undo.ts:79
- Commands and text updates run inside `doc.transact(..., origin)` to respect the unified history.
  - Reference: packages/client-core/src/commands/commandBus.ts:24, packages/client-core/src/hooks/useNodeText.ts:25

## Transactions & Yjs Helpers

- Centralized helpers initialize and access collections, create node text if missing, and enforce cycle checks when manipulating edges.
  - Reference: packages/client-core/src/yjs/doc.ts:21, packages/client-core/src/yjs/doc.ts:115, packages/client-core/src/yjs/doc.ts:132

## Edge Model & Mirrors

- Mirrors are edges: state like `collapsed` is stored on the edge, not the node. Insert/move/outdent/indent all operate on edges.
  - Reference: packages/client-core/src/types.ts:38, packages/client-core/src/commands/commandBus.ts:108
- Outline orchestration keeps selection and focus edge-local; `NodeEditor` reports focus changes with the current edge.
  - Reference: packages/client-core/src/components/OutlinePane.tsx:82, packages/client-core/src/components/OutlinePane.tsx:1329

## Virtualization & Performance

- Rows are computed via an incremental resolver and virtualized outline; heavy recomputation is avoided and keyed by doc version and collapsed state.
  - Reference: packages/client-core/src/hooks/useOutlineRowsSnapshot.ts:24, packages/client-core/src/virtualization/outlineRows.ts:17, packages/client-core/src/virtualization/edgeResolver.ts:15

## Considerations for Wiki Links

- Yjs transactions only: Do not mutate text or structure outside `doc.transact`; text insertion/decoration must go through Yjs types.
- Unified history: Tag local wiki link edits with `LOCAL_ORIGIN` so they are undoable, and ensure remote updates do not enter local undo.
- Edge-local state: Any display state tied to a link within mirrored nodes must be attached appropriately and not assumed to be node-global.
- Cursor safety: Avoid DOM surgery while typing; use controlled React updates and Yjs text ops to keep selection stable.
- Virtualization: Rendering of links and hover affordances must not break row virtualization; prefer lightweight spans and portal-based overlays.

This audit satisfies Step 1 by documenting current flows without changing runtime behavior.

