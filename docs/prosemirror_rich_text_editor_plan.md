# ProseMirror Rich Text Editor Implementation Plan

## Scope & Objectives
- Bring a ProseMirror-backed rich text surface to `NodeEditor` while preserving the behaviours referenced in `docs/rich_text_editor_requirements.md`.
- Provide the extensibility hooks necessary to ship the inline triggers defined in `docs/thortiq_spec_phase_2.md` §4.2 (wiki links, mirrors, tags, dates, selection formatting).
- Respect AGENTS.md constraints: no out-of-transaction DOM edits, keep undo unified, keep virtualization stable, maintain SOLID boundaries.

## Baseline Assessment
- `NodeEditor` currently renders a `<textarea>` whose value is persisted as sanitized HTML via the command bus; all structural commands (create node, indent, etc.) are issued manually.
- The `OutlinePane` composes virtualization via TanStack Virtual and schedules focus through `focusDirective`; render performance depends on predictable height measurements.
- Yjs data lives in shared collections initialised through `initializeCollections`; `CommandBus` orchestrates transactions and command history.

## Architectural Design
### Component boundaries
- Introduce a `ProseMirrorNodeEditor` React component (shared in `packages/client-core/src/richtext/`) encapsulating editor state, view lifecycle, and plugin wiring.
- Keep `NodeEditor` as a thin adapter that configures schema, commands, trigger providers, and surfaces callbacks to `OutlinePane`. This satisfies the shared-first requirement by keeping reusable logic in shared packages.
- Extract trigger popups and formatting toolbars into composable UI primitives housed alongside existing outline-pane UI, using headless controller hooks to separate view logic from data fetching.

### Schema & document modelling
- Model ProseMirror schema with block nodes aligned with stored HTML: `doc -> paragraph | heading(level) | bulletList/item` as needed for formatting parity.
- Define inline marks: `bold`, `italic`, `underline`, `textColor`, `backgroundColor`, `link`, `tag`, `mirror`, and `date`. Each mark carries stable IDs (UUIDs) rather than relying on indices.
- Store serialized ProseMirror JSON on the node (replace `html` or augment with parallel field); continue to emit sanitized HTML for read-only rendering until the HTML view migrates.
- Ensure schema supports inline decorations used by trigger suggestions without mutating document content (decorations computed from plugins).

### Yjs & CommandBus integration
- Use `y-prosemirror` binding to map the ProseMirror state to the node's Yjs text fragment, wrapping all writes in `CommandBus` transactions to honour the unified undo manager.
- Implement a bridge layer that converts ProseMirror steps into high-level commands (`update-node`, `split-node`, `merge-node`, etc.) so undo/redo stays aligned with current behaviour.
- Guarantee remote updates are applied via collaborative transactions that do not pollute local undo history by tagging transactions with metadata consumed by the `UndoManager`.

### Behaviour parity plan
- Re-implement Enter, Backspace, Tab, and drag interactions as ProseMirror commands that call existing command bus helpers (`create-node`, `indent-node`, etc.) to reproduce the tables in `docs/rich_text_editor_requirements.md`.
- Provide IME-safe composition handling by letting ProseMirror manage composition events while deferring structural commands until `handleDOMEvents` reports committed text.
- Maintain caret positioning using ProseMirror `Selection` updates so `focusDirective` can still place the caret precisely after async operations.

### Inline trigger infrastructure (foundation for §4.2)
- Create a pluggable trigger detector plugin that listens for token prefixes (`[[`, `((`, `#`, `@`, natural language date patterns) within the ProseMirror doc.
- Expose trigger context (range, typed query, `nodeId`, `edgeId`) through a shared `useInlineTrigger` hook that coordinates with popup UI components.
- For wiki links and mirrors, compute search results through existing outline index providers, filtering mirrors per "Mirrors are edges" by referencing edge metadata rather than node duplication.
- Emit lightweight decorations (e.g., underline for wiki links, pill styling for tags) computed from mark attributes so TanStack Virtual height remains stable.
- Prepare command handlers that, when a suggestion is committed, replace the trigger text with a properly attributed mark or mirrored edge creation command routed via `CommandBus`.

### UI composition for triggers & formatting
- Build headless controllers for popups that expose `isOpen`, `items`, `onSelect`, leaving rendering to lightweight components that can be reused across panes.
- Leverage portal targets anchored to the row container to avoid DOM mutations outside the editor and keep popups aligned without affecting layout.
- Reuse the trigger controller for the formatting toolbar, with mark toggles implemented as ProseMirror commands that add/remove marks while respecting collapsed selections.

### Performance & virtualization
- Measure editor heights via ProseMirror view `dom` without forcing synchronous layout thrash; throttle measurement updates so virtual rows remain responsive.
- Avoid expensive recomputation on every transaction by debouncing trigger searches and using memoized selectors for node lookups.
- Ensure mirror counts shown in the right gutter continue to derive from edge-level metadata, unaffected by inline mark decorations.

### Testing & verification
- Add unit tests for schema serialization/deserialization, trigger detection, and command conversions in `packages/client-core/__tests__/richtext`.
- Ship integration tests that simulate Enter/Backspace flows, wiki link creation, and mirror insertion through ProseMirror to verify behaviour parity.
- Provide storybook-style harness (or Playwright scenario) for the inline trigger popups to validate keyboard navigation.
- Document manual testing checklist covering IME usage, virtualization scroll stability, collaborative editing sessions, and undo/redo expectations.

### Migration & rollout
- Gate the ProseMirror editor behind a feature flag to allow incremental rollout across panes.
- Provide a migration script (CommandBus command) to translate existing `NodeRecord.html` into ProseMirror JSON once the editor stabilises.
- Update `docs/architecture` with a short adapter note describing the ProseMirror integration once implemented, referencing this plan.

## Risks & open questions
- Confirm whether node HTML must remain the source of truth for exports during transition; if so, define dual-write guarantees.
- Evaluate whether inline trigger popups can share search indices with existing global search to avoid duplicate indexing work.
- Clarify UX for mirrors within inline text (mark vs. inline node) to ensure caret movement feels natural.

## Deliverables
- New documentation: this plan plus follow-up architecture note during implementation.
- Updated shared modules under `packages/client-core` that introduce ProseMirror schema, plugins, and controller hooks.
- Reworked `NodeEditor` adapter using the shared ProseMirror component, with feature flag scaffolding and test coverage.

## Implementation Roadmap
1. **Foundation spike**
   - Create `packages/client-core/src/richtext/` with a feature-flagged `ProseMirrorNodeEditor` shell rendering a static document.
   - Wire up minimal schema (paragraph only) and render it inside the existing `NodeEditor` without persisting changes.
   - Tests: lightweight render test ensuring the feature flag toggles between textarea and ProseMirror variants.
2. **Schema & serialization**
   - Flesh out the full schema (headings, inline marks, mirrors/tags/date placeholders) and define JSON<->HTML conversion utilities.
   - Introduce unit tests for schema parsing and serialization parity with current HTML storage, including stable ID generation.
3. **Yjs binding & undo bridge**
   - Integrate `y-prosemirror`, routing all document mutations through the `CommandBus` while tagging transactions for undo isolation.
   - Ensure remote updates sync without entering local history; add integration tests covering collaborative edits and undo/redo.
4. **Behaviour parity commands**
   - Recreate Enter/Backspace/Tab logic as ProseMirror commands that delegate to existing structural commands (create/merge/indent).
   - Test via Jest/Playwright flows mirroring the tables in `docs/rich_text_editor_requirements.md` (Enter scenarios, Backspace merges, tab indent/outdent).
5. **Inline trigger infrastructure**
   - Implement trigger detection plugin, shared controller hooks, and popup adapters for wiki links, mirrors, tags, and dates.
   - Add unit tests for trigger parsing, plus interaction tests asserting popups open, filter, and commit correctly.
6. **Formatting toolbar & marks**
   - Build reusable formatting toolbar component backed by ProseMirror mark commands for H1-H5, bold, italic, underline, text/background colour.
   - Add mark toggling tests ensuring decorations persist across undo/redo and collaborative updates.
7. **Virtualization & performance tuning**
   - Connect ProseMirror view lifecycle to TanStack Virtual measurement hooks, debouncing height updates and trigger searches.
   - Write regression tests (or benchmarks) ensuring scroll performance remains within acceptable limits; add profiling checklist to docs.
8. **Migration & rollout**
   - Implement dual-write strategy (or migration) for node content, provide backfill command, and guard via feature flag rollout plan.
   - Update `docs/architecture` with the adapter note and document manual QA checklist covering IME, collaboration, and inline triggers.
