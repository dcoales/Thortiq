# ProseMirror-Only Refactor Execution Plan

> **Purpose**: actionable checklist for an LLM implementing the single-ProseMirror editor while satisfying `docs/rich_text_editor_requirements.md`, AGENTS.md, and enabling §4.2 inline triggers from `docs/thortiq_spec_phase_2.md`.
>
> **Preconditions**: `npm install` already run; working tree may contain unrelated changes (do not revert). Always finish sessions with `npm run lint && npm run typecheck && npm test`.

✅ Step 0 – Removed the ProseMirror feature flag, deleted the plaintext fallback, and updated tests for the single editor path.
✅ Step 1 – Added the shared editor factory, reorganised schema/serializers with wiki link scaffolding, and covered them with unit tests.

## Step 0 — Baseline Snapshot & Feature Flag Removal
- **Code changes**
  - Delete ProseMirror feature flag utilities (`isProseMirrorEditorEnabled`, env toggles) from `packages/client-core/src/richtext/featureFlags.ts` and any callers (e.g., `NodeEditor`, `SidePanel`, `App`).
  - Remove textarea fallback code paths and dead CSS used only by the plaintext editor.
- **Dependencies**: none.
- **Tests**: run existing `nodeEditorRichTextFlag.test.tsx`; update the test to reflect single-path editor (render check still required).
- **Accept**: no references to the feature flag remain; Jest suite compiles.
- **Docs**: note flag removal at top of this file before moving on.

## Step 1 — Rich Text Editor Factory & Schema audit
- **Code changes**
  - Create `packages/client-core/src/richtext/editorFactory.ts` exporting `createRichTextEditor(options)` that:
    - Accepts `{fragment, nodeId, edge, onFocusEdge, onTransaction, commandHooks}`.
    - Instantiates `EditorView` with `ySyncPlugin(fragment)` and configurable plugin array (include base keymap, custom structural command keymap, placeholder for trigger plugin).
    - Returns `{mount(dom: HTMLElement), destroy(), focusAt(offset: number | 'preserve'), getView(): EditorView | null}`.
  - Move shared schema import/serializers into `packages/client-core/src/richtext/schema/index.ts` and `packages/client-core/src/richtext/serializers/index.ts`. Add concise file-level docstrings describing responsibilities.
  - Audit `richTextSchema` to ensure marks/nodes support inline trigger requirements (wiki link mark with attrs for targetId/displayText, mirror mark with edgeId, tag/date marks placeholders). Do not implement triggers yet—just schema scaffolding + TODOs with owner/date if needed.
- **Dependencies**: Step 0 complete.
- **Tests**
  - New unit test `packages/client-core/src/__tests__/editorFactory.test.ts` verifying single instantiation, plugin wiring, and that destroy flushes focus callbacks.
  - Serializer round-trip test: JSON ↔ HTML ↔ Y.XmlFragment for paragraphs, bold/italic, wiki tag placeholder.
- **Accept**: factory file exports typed API; schema supports required marks; tests pass.
- **Docs**: add docstring referencing `docs/rich_text_editor_requirements.md` inside factory file.

## Step 2 — Command Wiring & Behavioural Commands
- **Code changes**
  - Implement structural command helpers in `packages/client-core/src/richtext/commands.ts` (Enter, Backspace, Tab) calling existing CommandBus operations. Each command receives `CommandContext` carrying `nodeId`, `edge`, `bus`, `doc`.
  - Ensure `CommandBus` updates (`packages/client-core/src/commands/commandBus.ts`) accept structured input from commands without duplicate plain-text writes.
  - Update `yjs/doc.ts` creation helpers so `create-node` initialises both `Y.Text` and `Y.XmlFragment` via shared serializer utilities.
  - Remove `syncPlainText` from old editor; ensure legacy plain text consumers read from `Y.Text` that now mirrors via `CommandBus` transaction.
- **Dependencies**: Step 1 (factory) complete.
- **Tests**
  - Extend existing Jest suite with DOM-driven tests in `prosemirrorSync.test.tsx` covering Enter split scenarios, Backspace merge, Tab indent/outdent using user events. Tests must mimic OutlinePane focus (AGENTS rule 19).
  - Add unit tests for command functions ensuring they invoke CommandBus with expected payloads (mock bus).
- **Accept**: commands available to factory; tests confirm behavioural parity tables.
- **Docs**: comment at top of `commands.ts` referencing behavioural table in `docs/rich_text_editor_requirements.md`.

## Step 3 — NodeEditor Refactor (Single active editor)
- **Code changes**
  - Rewrite `packages/client-core/src/components/NodeEditor.tsx`:
    - Split into `RichNodeEditor` (active) using factory and `RichNodePreview` (inactive) rendering sanitized HTML via `packages/client-core/src/richtext/RichTextPreview.tsx` (new component).
    - Manage mounting/unmounting by observing `isActive` prop; on unmount call `destroy()` on factory instance.
    - Provide focus callbacks to OutlinePane via adapter methods (e.g., `focusAt('preserve')` when regaining focus).
    - Ensure read-only preview keeps layout identical (wrap in same container className).
  - Remove textarea logic and state (`useNodeText` usage limited to preview only).
- **Dependencies**: Steps 1 & 2 (factory and commands) done.
- **Tests**
  - Update or add render tests verifying only one `.ProseMirror` exists when multiple editors rendered; non-active nodes show HTML.
  - Ensure accessibility attributes (aria-label, role) remain.
  - Re-enable `outlinePane.test.tsx` and `outlineInteractions.test.tsx` (currently skipped with TODO notes) once the refactor stabilises the single-editor path.
- **Accept**: NodeEditor exposes stable API, no textarea references.
- **Docs**: module-level comment summarising responsibilities; update this plan with completion notes.

## Step 4 — OutlinePane Focus Lifecycle
- **Code changes**
  - Modify `packages/client-core/src/components/OutlinePane.tsx`:
    - Track `activeEdgeId` and caret offset (store last known selection from `RichNodeEditor`).
    - Issue focus requests using precise caret offsets, not `-1`; only active node receives `focusDirective`.
    - Defer DOM measurement updates until after ProseMirror mount (use requestAnimationFrame or layout effect per virtualization guidelines).
  - Ensure virtualization row components accept `isActive` flag and render `RichNodeEditor` when true.
- **Dependencies**: Step 3 done.
- **Tests**
  - Integration test (DOM) verifying caret remains after typing at start when switching focus between two nodes.
  - Update any selection/focus regression tests that assumed textarea behaviour.
  - Restore the skipped caret-retention case in `prosemirrorSync.test.tsx` after the new focus lifecycle lands.
- **Accept**: Focus swapping retains selection; virtualization snapshots unchanged.
- **Docs**: inline comment near focus management referencing AGENTS rules 3,4,7.

## Step 5 — Inline Trigger Infrastructure Skeleton
- **Code changes**
  - Add `packages/client-core/src/richtext/plugins/inlineTriggers.ts` exporting ProseMirror plugin that detects triggers (`[[`, `((`, `#`, `@`, date patterns) and emits events via callback registry/shared hook.
  - Create `packages/client-core/src/richtext/hooks/useInlineTriggerContext.ts` exposing the latest trigger event and a dispatcher to resolve selections.
  - Wire plugin into factory but keep UI dormant (no popups yet); ensure plugin is idle when feature consumers absent.
- **Dependencies**: Steps 1-4 complete (editor stable).
- **Tests**
  - Jest unit tests verifying plugin emits trigger events for sample text, respects Live collaborative edits (simulate Yjs transaction), and clears after selection movement.
- **Accept**: Hook returns trigger data; plugin integrated but non-invasive.
- **Docs**: module comments referencing §4.2; update docs folder with `docs/architecture/prosemirror_inline_triggers.md` summarising design (include link back here per AGENTS rule 18).

## Step 6 — Read-Only Rendering & Shared Utilities
- **Code changes**
  - Implement `RichTextPreview` using sanitized HTML (no dangerous innerHTML outside React). Reuse in side panel, future mobile adapters if applicable.
  - Add helper `renderNodeHtml(nodeRecord)` in `packages/client-core/src/richtext/utils.ts` to centralise sanitisation and styling toggles.
- **Dependencies**: Step 3 (preview usage) ready.
- **Tests**
  - Snapshot tests ensuring preview renders expected HTML for headings/lists/wiki mark placeholder.
  - Accessibility test verifying preview remains non-editable (`aria-readonly`).
- **Accept**: consistent rendering across surfaces.
- **Docs**: inline comments referencing visual parity requirement.

## Step 7 — Regression, Performance, and QA Checklist
- **Actions**
  - Run full suite: `npm run lint && npm run typecheck && npm test`.
  - Add manual QA checklist to `docs/architecture/prosemirror_inline_triggers.md` covering IME, collaboration, 1k-node scroll, undo/redo, caret split scenarios.
  - If profiling reveals slow render, add TODO with owner/date and brief findings.
- **Accept**: pipelines pass; documentation updated; plan annotated with completion status per step.

## General Implementation Rules
- No HTML/text mutations outside Yjs transactions (AGENTS rule 3).
- Keep comments concise and meaningful; add module docblocks per new file (rule 15).
- Use composable helpers/hooks (rules 8, 17); avoid inheritance.
- Tests that touch editor must exercise DOM flow (rule 19).
- Stable IDs via UUID utilities; never rely on array indices (rule 11).

When each step is finished, update this document with a short “✅ Step N – summary” line before continuing, so future agents know the status. EOF
