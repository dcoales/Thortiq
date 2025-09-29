# Section 2 Implementation Plan

> **Always follow the constraints in `AGENTS.md` while working on any step below.** Each task must finish by running `npm run lint && npm run typecheck && npm test` at the repo root. Mark the relevant step as complete only after these tests pass.

## Step 1 – Align Outline Row UI with Spec (§2.1–§2.3)
- **Requirements:** docs/thortiq_spec.md §2.1 Expand/Collapse Icons, §2.2 Node Size, §2.3 Node Bullets.
- **Intent:** Ensure every row renders the expand caret, maintains alignment regardless of child presence, and shows the “bullet inside grey circle” indicator when collapsed. Preserve variable-height text wrapping without breaking TanStack measurements.
- **Work Items:**
  - Update `apps/web/src/outline/OutlineView.tsx` (and associated style helpers) to render a consistent placeholder when no caret exists, apply the collapsed-state bullet styling, and keep row metrics shared between read-only and editable states.
  - Document any new style helpers with concise comments describing the visual invariants.
- **Testing:** Extend or add DOM tests in `apps/web/src/outline/OutlineView.test.tsx` validating icon presence, alignment, and collapsed indicator. Run the global test suite (`npm run lint && npm run typecheck && npm test`).
- **Completion:** After tests pass, update the plan (or PR notes) marking Step 1 complete.

## Step 2 – Multi-Selection & Selection Gestures (§2.4)
- **Requirements:** docs/thortiq_spec.md §2.4 Node selection.
- **Intent:** Allow users to select multiple nodes via click combinations and drag-selection while keeping selection state consistent with virtualization.
- **Work Items:**
  - Introduce a selection manager (e.g., hook or store) in `apps/web/src/outline` that tracks an ordered `Set<EdgeId>` plus anchor/focus.
  - Wire row click handlers for Shift/Ctrl/Cmd logic, and implement drag-to-select without interfering with ProseMirror editing.
  - Ensure selection highlight respects virtualization and updates active editor edge when needed.
- **Testing:** Add unit coverage for selection helpers (new module). Add integration tests in `OutlineView.test.tsx` covering multi-select scenarios. Run `npm run lint && npm run typecheck && npm test`.
- **Completion:** Upon passing tests, mark Step 2 complete.

## Step 3 – Outline Editing Commands for Keyboard & Editor (§2.5)
- **Requirements:** docs/thortiq_spec.md §2.5 Basic Node Editing (including sub-sections 2.5.1–2.5.6).
- **Intent:** Centralize outline-aware editing logic so both outline keyboard events and the ProseMirror editor enforce the spec’s behaviours.
- **Work Items:**
  - Expand `packages/outline-commands` with helpers for inserting above/below/child, splitting nodes, merging/backspacing rules, batch delete with confirmation, Ctrl+Enter toggle, and multi-node indent/outdent.
  - Ensure each helper wraps mutations in a single `withTransaction` call so undo history stays atomic.
  - Add a ProseMirror keymap plugin (e.g., `packages/editor-prosemirror/src/outlineKeymap.ts`) that delegates to these commands while respecting caret context.
  - Update `ActiveNodeEditor` to register the new keymap and coordinate selection state.
- **Testing:** Add command-level unit tests in `packages/outline-commands/src/index.test.ts`. Add ProseMirror integration tests (enable skipped suite or create new ones) validating keyboard behaviour. Finish with `npm run lint && npm run typecheck && npm test`.
- **Completion:** After green tests, mark Step 3 complete.

## Step 4 – Drag & Drop Reordering (§2.6)
- **Requirements:** docs/thortiq_spec.md §2.6 Drag and drop and supporting diagram.
- **Intent:** Implement drag handles, ancestor-aware drop zones, grey drop indicator, and multi-item drag reordering without disturbing virtualization.
- **Work Items:**
  - Design hitbox calculations for ancestor “red boxes” and text “blue boxes” using row geometry; integrate with TanStack virtual rows to minimize per-frame cost.
  - Render drop indicator aligned per spec, handle mirror/cycle guards via existing `client-core` validations, and move all selected nodes while preserving order.
  - Display drag count badge on the drag avatar.
- **Testing:** Add interaction tests (React Testing Library + pointer events) covering single/multi-node drag, ancestor drop alignment, and indicator updates. Consider lightweight utility unit tests for geometry calculations. Run `npm run lint && npm run typecheck && npm test` when done.
- **Completion:** Mark Step 4 complete only after all tests succeed.

## Step 5 – Ancestor Guidelines Interaction (§2.7)
- **Requirements:** docs/thortiq_spec.md §2.7 Ancestor Guidelines.
- **Intent:** Draw vertical guideline segments per ancestor, highlight on hover, and support click-to-toggle behaviour.
- **Work Items:**
  - Extend row rendering to emit guideline segments (likely flex column or absolute overlay) while keeping measurement cheap.
  - Centralize hover state so all segments for the same ancestor highlight together.
  - Implement click behaviour to open/close immediate children using `toggleCollapsedCommand` with batching for multi-child updates.
- **Testing:** Add DOM tests ensuring guideline rendering, hover highlight, and click toggles. Measure performance (manual check) to ensure virtualization unaffected. Run repo-wide tests (`npm run lint && npm run typecheck && npm test`).
- **Completion:** Mark Step 5 complete once tests pass.

## Step 6 – Unified Undo/Redo Validation (§2.8)
- **Requirements:** docs/thortiq_spec.md §2.8 Undo / Redo and AGENTS.md rules 3 & 6.
- **Intent:** Confirm all local edits—text, formatting, structural—flow through the shared `UndoManager` in single logical steps and exclude remote edits from local history.
- **Work Items:**
  - Audit new commands/plugins ensuring every mutation is wrapped in a single transaction per logical action and captured origin belongs to the tracked set (`SyncContext.isTrackedOrigin`).
  - Where multiple transactions are required (e.g., cascading toggles), group them with explicit `undoManager.stopCapturing()` boundaries.
  - Add regression tests (unit/integration) verifying a single undo reverses each spec-defined action, and that remote-origin transactions are not undoable locally.
- **Testing:** Implement new tests (could live in `packages/sync-core` or editor integration suite). Run `npm run lint && npm run typecheck && npm test`.
- **Completion:** After successful tests, mark Step 6 complete.

## Step 7 – Documentation & Final Verification
- **Requirements:** docs/thortiq_spec.md §2 summaries, AGENTS.md §15 (Explain intent) & §18 (Document structural shifts if any).
- **Intent:** Ensure code comments, module headers, and docs reflect the implemented behaviours for future agents.
- **Work Items:**
  - Add/refresh module-level comments in newly created or significantly changed files explaining responsibilities and invariants.
  - If architecture changes (e.g., new drag/drop subsystem) warrant it, document under `docs/architecture` and link from task/PR notes.
  - Revisit `docs/thortiq_spec.md` if clarifications were required (ask first if spec adjustments might cause regressions).
- **Testing:** Final run of `npm run lint && npm run typecheck && npm test`.
- **Completion:** Mark Step 7 complete once documentation and tests are finalized.

---

Following this plan sequentially will satisfy all items in Section 2 while preserving the existing ProseMirror integration and complying with `AGENTS.md`.
