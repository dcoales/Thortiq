# Section 8 Context Menu Implementation Plan

1. **Review existing context menu + formatting infrastructure**
   - Inspect shared context menu utilities (search in `packages/client-core` and `packages/client-react`) and any existing `/` command palette actions to ensure reuse aligns with AGENTS.md rule 13.
   - Map current formatting command descriptors so the Format submenu can reference a single shared definition (avoid duplication per AGENTS.md rule 10).
   - Identify current multi-select handling so right-click on a selected node leverages the same selection model.
   - Findings:
     - There is no dedicated context menu component today; overlay behaviour lives in `packages/client-react/src/outline/components/FloatingSelectionMenu.tsx` and the inline formatting UI in `SelectionFormattingMenu.tsx`, both of which render via portals to keep TanStack Virtual stable. The right-click menu should reuse the same portal strategy instead of mounting inside rows.
     - Formatting actions are defined ad-hoc inside `SelectionFormattingMenu.renderToolbar`, but they ultimately call the `CollaborativeEditor` helpers (`toggleHeadingLevel`, `toggleBold`, etc.) backed by `packages/editor-prosemirror/src/formattingCommands.ts`. Extracting those descriptors into a shared module will let the context menu and floating toolbar stay in sync.
     - Multi-select state comes from the session-backed range stored in `packages/client-core/src/outlineStore/store.ts` (`pane.selectionRange`) and exposed through `useOutlineSelection` (`packages/client-react/src/outline/useOutlineSelection.ts`). The context menu should consume `orderedSelectedEdgeIds`/`selectedEdgeIds` from that hook instead of rolling its own selection tracking.
     - There is no `/` command palette yet. The inline trigger infrastructure (`packages/editor-prosemirror/src/inlineTriggerPlugin.ts`) already powers wiki `[[` and mirror `((` dialogs via dedicated plugins, so we can adapt it for slash commands in later steps without duplicating trigger handling.

2. **Define shared command descriptors**
   - Create or extend TypeScript interfaces in `packages/client-core` for context menu entries, including metadata for submenus and multi-selection applicability (respect rule 12; add comments for intent per rule 15).
   - Ensure commands encapsulate side-effects (marking tasks, setting inbox/journal, move/mirror/delete) so UI components only dispatch actions (SOLID rule 8).
   - Added `packages/client-core/src/contextMenu/outlineContextMenu.ts`, which centralises descriptor types, execution context contracts, and flattening helpers. Platform adapters can now read `OutlineContextMenuNode` trees while command implementations live alongside domain logic instead of in UI components.

3. **Ensure Yjs transaction-safe operations**
   - Audit the command handlers (task toggle, inbox/journal assignment, move/mirror, delete) to confirm all structural/text mutations run inside `withTransaction` helpers (rule 3) and route through the shared UndoManager (rule 6).
   - Add concise comments where transactions span multiple operations to clarify boundaries (rule 2).
   - Wrapped the bulk move helpers (`indentEdges`, `outdentEdges`, and `mergeWithPrevious`) in shared transactions so multi-node operations emit a single undo entry; added inline notes explaining the batched transaction boundaries alongside the existing delete flow.

4. **Build the Right Click menu component**
   - Implement the context menu UI in the React adapter (`packages/client-react/src/outline/components`), wiring to shared command data.
   - Verify virtualization compatibility (rule 7/23) by ensuring the menu renders in an overlay/portal without forcing additional rows to mount.
   - Maintain keyboard-first interactions for accessibility (rule 34) and ARIA roles consistent with other menus.

5. **Format submenu**
   - Reuse formatting command list from the inline popup so both sources stay in sync; expose a helper that returns descriptors with icon + label.
   - When executing a format action, apply it to all selected nodes via shared formatting helpers (using transactions and undo integration).
   - Implement “Clear formatting” to strip both node-level and range-level marks (consult `docs/formatting.md` for invariants).

6. **Turn Into submenu**
   - Tasks: reuse existing todo metadata helpers so toggling via menu matches Ctrl+Enter behavior; ensure Yjs + UndoManager compliance.
   - Inbox / Journal: centralize singleton metadata management (likely in `client-core`) with guard rails for confirmation dialogs when reassigning.
   - Emit events that UI adapters can intercept to show confirmation dialogs (keep side-effects outside core per rule 8/13).

7. **Move To dialog integration**
   - Reuse the search-list dialog used for wiki/mirror operations; abstract shared query + virtualization logic if not already shared.
   - Add input filtering that supports multi-term AND matching with score sorting by shortest match; write unit tests in shared package (rule 16).
   - Implement dropdown for insert position (First/Last child) and ensure resulting move uses CRDT-safe operations preventing cycles (rules 5 & 26).

8. **Mirror To dialog**
   - Reuse the Move dialog with mode-specific action that creates a mirror edge instead of moving the original.
   - Validate cycle prevention logic is shared with Move; add regression tests covering mirror + move interactions.

9. **Delete command**
   - Hook into existing delete workflow so confirmation dialogs trigger when deleting >30 nodes and when originals with mirrors are removed.
   - Ensure mirror promotion logic runs inside a single transaction encompassing the delete (rules 3 & 29).
   - Update user messaging utilities to report counts; add unit/integration tests for prompts.

10. **Multi-select behavior**
   - Confirm selection model already tracks multi-row selection; ensure commands operate on the full selection when the context menu is invoked on a selected node.
   - Add guard so context menu on non-selected node collapses selection to that node before running commands.
   - Verify undo/redo maintains expected order for multi-node operations (rule 6).

11. **UI/UX polish**
   - Add hover states, disabled command states, and loading guards to match app design; confirm no DOM surgery occurs during typing (rule 4).
   - Ensure dialog focus management returns to the originating list after completion (rule 36).
   - Validate drag-and-drop indicators remain unaffected (rule 35).

12. **Testing & verification**
   - Add shared unit tests for command descriptors, move/mirror search filtering, singleton reassignment, and delete confirmation thresholds (rule 16).
   - Extend integration/e2e tests (web app) to cover invoking each menu command, including multi-select scenarios, ensuring UndoManager history integrity.
   - Manually verify right-click menu respects keyboard shortcuts and works offline (rule 28); document test steps in verification notes if required.

13. **Documentation & follow-up**
   - Update relevant docs (`docs/thortiq_spec.md` references, formatting docs, help overlays) to mention the context menu once implemented.
   - If new adapters or shared utilities were introduced, add a short note in `docs/architecture` referencing their responsibilities (rule 14/18).
   - Before finalizing implementation, run `npm run lint && npm run typecheck && npm test` (rule 1) and summarize results along with remaining risks.
