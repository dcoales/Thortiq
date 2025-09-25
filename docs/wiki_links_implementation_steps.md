# Wiki Links Implementation Guide (Section 4.2.1)

Each step below is phrased as a standalone prompt Codex can execute. Ensure every change follows the guardrails in `AGENTS.md`, especially around Yjs transactions, SOLID boundaries, and comment restraint. Run the listed tests before marking a step complete.

## Step 1 — Audit Existing Inline Trigger & Metadata Flow

**Prompt**

Review `NodeEditor`, `OutlinePane`, relevant hooks, and Yjs helpers to document how inline text, attributes, and undo are currently handled. Summarize findings in code comments or a short Markdown note (under `docs/`) without modifying runtime behaviour. Highlight considerations the Wiki Links feature must respect (transactions, edge handling, virtualization). Do not write new logic yet.

**Tests**

- `npm run lint`

## Step 2 — Introduce Wiki Link Data Structures & Utilities

**Prompt**

Add TypeScript types, ID factory functions, and helper utilities for wiki links (parse/serialize, HTML rendering). Place shared logic in a dedicated module under `packages/client-core/src/wiki/`. Ensure helpers never mutate Yjs state directly and include concise intent comments. Export the utilities through the package index for reuse.

**Tests**

- `npm run lint`
- `npm run typecheck`

## Step 3 — Implement the `[[` Trigger Workflow

**Prompt**

Update `NodeEditor` to detect the `[[` trigger, surface a popup of candidate nodes (with breadcrumbs), support incremental filtering across multiple terms, and handle keyboard/mouse selection. Integrate with the UndoManager via existing command bus patterns, ensuring wiki link insertion happens within Yjs transactions and respects mirrors-as-edges rules. Keep view logic separated into small, composable helpers or hooks when possible.

**Tests**

- `npm run lint`
- `npm run typecheck`
- `npm test`

## Step 4 — Render Wikilinks with Hover Edit Affordance & Navigation

**Prompt**

Render inserted wiki links as underlined spans in the node view layer. On hover, display the floating edit affordance without displacing adjacent text. Clicking a wikilink should focus the target node by delegating to `OutlinePane` while preserving focus history. Ensure virtualization performance stays intact and no DOM mutations occur outside controlled React updates.

**Tests**

- `npm run lint`
- `npm run typecheck`
- `npm test`

## Step 5 — Add Wikilink Edit Dialog

**Prompt**

Add the two-field edit dialog (Display text editable, Target node read-only) activated from the hover affordance. Persist display text updates transactionally without changing the target node. Handle cursor restoration and metadata updates via the new wiki utilities. Confirm the dialog closes cleanly and state resets when nodes rerender.

**Tests**

- `npm run lint`
- `npm run typecheck`
- `npm test`

## Step 6 — Expand Test Coverage & Performance Safeguards

**Prompt**

Augment unit/integration tests (e.g., in `packages/client-core/src/__tests__`) to cover trigger detection, dialog filtering, wikilink insertion, navigation, and editing. Verify no excessive recomputation occurs per keystroke (add debouncing or memoization where needed). Update docs if architectural shifts occurred.

**Tests**

- `npm run lint`
- `npm run typecheck`
- `npm test`

## Step 7 — Final Validation & Follow-ups

**Prompt**

Run the full validation suite, resolve any outstanding TODOs, and document residual risks or future enhancements in the spec addendum. Ensure all wiki link data flows comply with `AGENTS.md` (transactions, SOLID, MIRROR edges, undo). Provide a concise summary of implemented behaviours.

**Tests**

- `npm run lint`
- `npm run typecheck`
- `npm test`
