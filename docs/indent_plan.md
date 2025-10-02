# ProseMirror Indent Key Handling Plan

## Context
- Clicking a row and pressing `Tab` in the outline shell works because `apps/web/src/outline/OutlineView.tsx` intercepts the key and calls `indentEdges`. Once the ProseMirror editor owns focus, `handleKeyDown` returns early (`isEditorEvent(...)`), so `Tab`/`Shift+Tab` fall through to the browser and move focus out of the editor.
- `createCollaborativeEditor` only loads `ySyncPlugin`, `yUndoPlugin`, history bindings, and `baseKeymap`. None of these override `Tab`, so the editor never invokes our outline commands while focused.
- Section 2 of the implementation plan already asks for a ProseMirror keymap that routes editing keys through the shared outline command layer. This document scopes the work needed to implement the missing pieces.

## Goals
1. Trap `Tab`/`Shift+Tab`, `Enter`, `Shift+Enter`, and `Backspace` inside ProseMirror so structural edits use the same command helpers regardless of focus.
2. Ensure every mutation happens inside a Yjs transaction with the shared `UndoManager` so undo/redo treats each keystroke as one logical step.
3. Keep outline logic reusable: shared-first modules in `packages/*`, thin wiring inside React components, no DOM manipulation outside ProseMirror transactions.

## High-Level Approach
- Create a dedicated keymap plugin (e.g. `packages/editor-prosemirror/src/outlineKeymap.ts`) that exposes a factory returning a ProseMirror plugin configured with the active outline context (selected edge, selection set, command helpers, etc.).
- Register this plugin ahead of `baseKeymap` so its handlers fire first and return `true` to prevent the browser default and subsequent keymaps.
- Update `ActiveNodeEditor` to construct the plugin with the same command primitives used by the outline shell, keeping the editor and shell in sync.
- Propagate results (e.g. updated selection) back to React state as needed without duplicating logic.

## Detailed Steps for an Implementing Agent

### 1. Add outline keymap module
- Create `packages/editor-prosemirror/src/outlineKeymap.ts`.
- Export a small factory, e.g. `createOutlineKeymap(options: OutlineKeymapOptions): Plugin`. Options should include:
  - `commands`: references to `indentEdges`, `outdentEdges`, `insertSiblingBelow`, `insertChild`, merge/backspace helper, etc.
  - `selection`: the currently selected `EdgeId` plus helper callbacks to update selection (`setSelectedEdgeId`, maybe multi-select set) without coupling to React.
  - `context`: references to `outline`, `localOrigin`, and `UndoManager` so commands can wrap transactions.
- Implement ProseMirror `Command` handlers for:
  - `Tab`: indent selected nodes. When selection spans multiple edges, rely on the shared selection set to compute the ordered subset (mirrors `handleKeyDown`).
  - `Shift-Tab`: outdent.
  - `Enter`: split/insert sibling below. Confirm how list item splitting should behave per spec §2.5; call the matching outline command.
  - `Shift-Enter`: insert child below current node.
  - `Backspace`: delegate to existing merge/backspace command (or add one in `@thortiq/outline-commands` if missing).
- Each handler must call the outline command inside `withTransaction` (existing helpers should already do this). Return `true` when a command succeeds, `false` otherwise so ProseMirror can fall back if needed.
- Compose the handlers with `keymap` from `prosemirror-keymap` and export the plugin.

### 2. Surface shared selection helpers
- If the outline shell keeps selection state privately, expose a lightweight adapter layer (e.g. `packages/outline-commands/src/selectionContext.ts`) or extend `ActiveNodeEditor` props to pass the functions the keymap needs.
- Avoid importing React state directly inside the plugin. Instead, pass callables (`getSelection`, `setSelectionRange`, etc.) from `ActiveNodeEditor` when creating the editor instance.

### 3. Wire plugin into `createCollaborativeEditor`
- Extend `CreateCollaborativeEditorOptions` in `packages/editor-prosemirror/src/index.ts` with the new callbacks/selection context and include the plugin when building the state (`createState`). Place the plugin before history/base keymap in the array.
- Ensure `createState` remains pure; the plugin factory should be called outside to avoid capturing stale closures when swapping nodes.
- When `setNode` runs, update any stateful selection helpers so the plugin targets the new edge.

### 4. Update `ActiveNodeEditor`
- When mounting the editor, pass the current selection context (e.g. `selectedEdgeId`, `selectedEdgeIds`, setter functions) to `createCollaborativeEditor`.
- Subscribe to selection changes from the outline store to keep the plugin in sync (the plugin may need a `setSelectionSnapshot` method or reactive callback).
- Ensure the editor still focuses after container switches and that moving between rows updates the plugin state.

### 5. Tests
- Add unit tests in `packages/editor-prosemirror/src/index.test.ts` or a new suite verifying the keymap intercepts `Tab` and calls the outline command mocks.
- Extend integration tests in `apps/web/src/outline/OutlineView.test.tsx` (enable the skipped ProseMirror suite if feasible) to simulate pressing `Tab` while the editor has focus and assert the outline tree mutates correctly while focus stays put.
- Verify `npm run lint && npm run typecheck && npm test` succeed.

## Validation Checklist
- [ ] `Tab` inside the editor indents the active row(s) without moving browser focus.
- [ ] `Shift+Tab`, `Enter`, `Shift+Enter`, and `Backspace` behave identically whether the shell or editor own focus.
- [ ] All structural edits pass through Yjs transactions with the tracked origin so undo/redo works across shell/editor actions.
- [ ] No DOM manipulation occurs outside ProseMirror transactions; selection updates route through shared state APIs.
- [ ] Documentation (`docs/architecture/editor-integration.md`) updated if new adapter interfaces are introduced.

## Notes
- Remember mirrors are edges—store per-edge collapse/indent metadata on the edge, not the node.
- Keep the plugin free of React imports; expose clean TypeScript interfaces so desktop/mobile shells can reuse it later.
- If any command requires new shared utilities, place them in `packages/outline-commands` with concise intent comments and matching unit tests.
