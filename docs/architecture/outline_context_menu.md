# Outline Context Menu

## Responsibilities
- Describe the shared descriptor schema that every platform consumes when rendering the outline right‑click menu.
- Keep execution logic inside transaction-safe helpers so UndoManager history stays unified.
- Provide adapter hooks for dialogs (Move/Mirror, singleton reassignment) without baking UI concerns into shared code.

## Key Modules
- `packages/client-core/src/contextMenu/outlineContextMenu.ts`  
  Defines the `OutlineContextMenuNode` tree, selection snapshot contract, and helpers (`flattenOutlineContextMenuTree`, type guards). All commands receive an `OutlineContextMenuExecutionContext` so they can run inside Yjs transactions and respect the unified UndoManager.
- `packages/client-react/src/outline/contextMenu/createOutlineContextMenuDescriptors.ts`  
  Builds the node tree for the web app, wiring shared outline commands, formatting helpers, task toggles, and singleton assignments. Emits events (`requestMoveDialog`, `requestSingletonReassignment`) so adapters can open dialogs without reimplementing business rules.
- `packages/client-react/src/outline/contextMenu/useOutlineContextMenu.ts`  
  Tracks open/close state, normalises selection snapshots, and hands the descriptor tree plus execution context to the presentation layer.
- `packages/client-react/src/outline/components/OutlineContextMenu.tsx`  
  Renders the menu in a portal anchored at the pointer, supports keyboard navigation, nested submenus, async command states, and dismiss behaviour required for TanStack Virtual compatibility.

## Adapter Flow
1. `OutlineView` calls `useOutlineContextMenu` with the current outline, selection, and command handlers.
2. When a context-menu gesture arrives, the hook captures a selection snapshot, constructs the descriptor tree, and stores the execution context.
3. The `OutlineContextMenu` component reads that state, renders commands/submenus, and runs the `node.run` handler inside `Promise.resolve` so async flows (confirmation dialogs, move/mirror requests) can resolve before closing.
4. Platform-specific dialogs (Move/Mirror picker, singleton reassignment confirmation) subscribe to the emitted events and keep side-effects out of the shared descriptor builder per SOLID/Shared-first rules (#8, #13).

## Notes
- Formatting commands reuse `packages/client-react/src/outline/formatting/formattingDefinitions.ts`, keeping the floating toolbar and context menu fully aligned.
- Bulk operations (`indentSelection`, `delete`, `mirrorNodesToParent`) call shared helpers that wrap `withTransaction`, so multi-node edits register as single undo entries.
- Selection snapshots always flow through `applySelectionSnapshot`, ensuring multi-select context menu actions keep TanStack Virtual and awareness cursors in sync.
