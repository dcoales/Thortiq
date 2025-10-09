II# Tags Implementation Plan

Follow these steps in order. Keep every code change aligned with the constraints in `AGENTS.md`: wrap mutations in `withTransaction`, maintain a single ProseMirror editor instance per active node, keep undo history unified, avoid DOM hacks that could break virtualization, and preserve keyboard-first UX.

1. **Audit Current State**
   - Survey existing tag representations or placeholder logic (`packages/client-core`, `packages/client-react`, search modules) and note any conflicting assumptions.
   - Document relevant entry points (editor schema, search bar controller, Yjs document shape) before touching code so the implementation plan stays incremental.

2. **Model Tag Metadata**
   - Define a shared tag registry in Yjs (e.g., a `Y.Map` keyed by normalized tag id) storing display label, trigger (`#`/`@`), and timestamps for creation/last usage to support “most recently created” sorting.
   - Provide typed accessors in shared domain code (`packages/client-core`) that always mutate via `withTransaction` and update `UndoManager` scopes correctly.
   - Expose a read-only selector that returns tags sorted by `createdAt` (descending) for UI consumption; ensure it is memoized to avoid re-sorting large collections on every render.

3. **Extend Editor Schema**
   - Confirm or introduce a ProseMirror mark/node type representing a tag pill; keep schema changes in shared editor schema modules.
   - Include attributes for tag id, trigger character, and display text; enforce stable ids rather than positional indexes.
   - Add module-level comments explaining invariants (tag nodes are inline, non-splittable, serialized consistently).

4. **Detect Trigger Characters**
   - Implement an input rule or plugin that watches for `#` / `@` typed in editable nodes.
   - When detected, capture the trigger range, open a suggestion controller, and ensure no direct DOM mutation occurs outside ProseMirror transactions.
   - Debounce filtering logic to avoid re-computing candidate lists on every keystroke when outlines are large.

5. **Build Tag Suggestion UI**
   - Create a reusable suggestion popover component (React) that can anchor to the caret position while respecting TanStack Virtual measurements (avoid forcing reflow on every frame).
   - Provide keyboard support (ArrowUp/Down, Enter, Escape) and mouse selection. Verify that focus management follows rule 36 and does not instantiate extra editors.
   - Ensure the list filters client-side by prefix and trigger character, defaulting to the first item highlighted.

6. **Handle Tag Selection**
   - On acceptance (Enter/Click), run a single Yjs transaction that replaces the trigger text with the tag node/mark, inserts a trailing space if needed, and updates the tag registry `lastUsedAt`.
   - Dispatch through the shared undo manager so the operation is atomic for undo/redo.
   - Close the suggestion popover and restore caret position after the inserted space.

7. **Render Tag Pills**
   - Style tag nodes as colored pills (shared styling utility) without breaking visual parity between read-only and editable views.
   - Persist theme tokens so pills render consistently across platforms, and document how colors are chosen (default palette, deterministic fallback).
   - Ensure serialization/deserialization keeps tag metadata intact for sync and offline usage.

8. **Backspace & Editing Recovery**
   - Add plugin logic: when caret backs up into the start of a tag pill, convert it back to plain text and reopen the suggestion list.
   - Guarantee the conversion occurs inside a transaction and maintains undo grouping with prior edits.
   - Write regression tests to cover both local and remote tag edits (remote changes should not pollute local undo history).

9. **Search Integration**
   - Enhance the search bar controller to accept `tag:<name>` filters, appending or toggling them when a pill is clicked per spec.
   - Clicking a tag should open the search UI (respecting existing focus transitions) and inject/remove the filter without scrambling prior search terms.
   - Update shared search utilities to understand tag filters so results remain consistent across panes and platforms.

10. **Telemetry & Performance Guards**
   - Add lightweight instrumentation (if available) to measure suggestion open latency and tag creation frequency.
   - Verify no extra renders occur for non-active rows by profiling with large outlines; ensure suggestion popover unmounts cleanly to prevent leaks.

11. **Testing & Validation**
   - Write unit tests for tag registry helpers, ProseMirror plugins, and search filter parsing in shared packages.
   - Add integration/editor tests that simulate typing triggers, selecting tags, undo/redo, backspacing, and clicking pills to ensure behavior matches the specification.
   - Finish by running `npm run lint && npm run typecheck && npm test` to satisfy Core Stability Rule 1.

12. **Documentation & Follow-up**
    - Update any relevant architecture docs (e.g., editor or search overviews) to explain the new tag flow and reference this plan.
    - Capture residual questions (color palette UX, cross-device sync considerations) for product review before closing the task.

## Step 1 — Audit Current State

- **Yjs document shape (`packages/client-core/src/doc/nodes.ts:169`)** — Node metadata stores tags as a `Y.Array<string>` seeded during `createNode`; `updateNodeMetadata` replaces the array wholesale inside `withTransaction`. There is no shared registry yet, so tags remain per-node strings without normalization or provenance.
- **Shared types and defaults (`packages/client-core/src/types.ts:9`, `packages/client-core/src/doc/nodes.test.ts:33`)** — `NodeMetadata` exposes `tags: ReadonlyArray<string>` and tests assert the default is an empty list; upstream consumers already assume tags are lower-level metadata rather than structured entities.
- **Search indexing (`packages/client-core/src/search/index.ts:177`)** — The incremental index deduplicates tags from three sources: node metadata, inline marks with `mark.type === "tag"`, and raw `#tag` text via `TAG_TEXT_PATTERN`. The mark branch is placeholder only—the ProseMirror schema does not currently define a `tag` mark, so this code path never executes.
- **Search parsing & filters (`packages/client-core/src/search/types.ts:20`, `packages/client-core/src/search/__tests__/queryParser.test.ts:21`)** — The advanced query language already treats `tag:` as a first-class filter and supports shorthand literals like `NOT #archived`, implying tags must be normalised for case-insensitive comparisons.
- **Outline store integration (`packages/client-core/src/outlineStore/store.ts:175`)** — `createSearchIndex` is instantiated once per session; pane search runtimes cache matches but expose no helpers for manipulating tag metadata. Any future registry changes must keep the incremental index notifications cheap to respect virtualization rules.
- **Editor schema gap (`packages/editor-prosemirror/src/schema.ts:23`)** — The schema extends the basic set with a `wikilink` mark only; there is no tag mark/node, nor a trigger plugin configured for `#`/`@`. This conflicts with search expectations and confirms tag pills are not yet represented in the editor.
- **React outline UI (`packages/client-react/src/outline/components/OutlineRowView.tsx:117`, `packages/client-react/src/outline/usePaneSearch.ts:1`)** — Inline spans render plain text; there is no tag-specific styling or interaction. The pane search controller parses `tag:` filters but lacks affordances to insert or manage tags from the row view.

**Conflicting assumptions**
- Search indexing already anticipates a dedicated `tag` mark while the editor schema does not define one, so inserting real tag pills today would fail serialization.
- Tags live only on individual nodes; there is no shared catalogue to drive suggestion ranking or deduplicate labels across the document, which Step 2 must introduce.

## Step 2 — Model Tag Metadata

- **Shared registry map (`packages/client-core/src/doc/constants.ts:9`, `packages/client-core/src/doc/transactions.ts:36`)** — `OutlineDoc` now allocates a `tagRegistry` Y.Map keyed by normalized ids so every client shares a single source of tag truth alongside nodes and edges.
- **Type surface + undo coverage (`packages/client-core/src/types.ts:21`, `packages/client-core/src/sync/SyncManager.ts:195`)** — New `TagTrigger`/`TagRegistryEntry` types describe the registry payload while the undo manager tracks `outline.tagRegistry` to keep tag edits in the unified history.
- **Registry helpers (`packages/client-core/src/doc/tags.ts:1`)** — Added transactional helpers (`upsertTagRegistryEntry`, `touchTagRegistryEntry`, `removeTagRegistryEntry`, `getTagRegistryEntry`) plus a memoized selector `selectTagsByCreatedAt` that caches on an internal version counter to avoid re-sorting large registries.
- **Unit coverage (`packages/client-core/src/doc/tags.test.ts:1`)** — Tests cover id normalization, timestamp updates, cache memoization, and removal semantics so downstream adapters can rely on deterministic behaviour before UI work begins.

## Step 3 — Extend Editor Schema

- **Tag mark spec (`packages/editor-prosemirror/src/schema.ts:8`)** — Added a non-inclusive `tag` mark with `id`, `trigger`, and `label` attributes, serialised via deterministic `data-tag-*` attributes so collaborative snapshots round-trip across platforms without drift.
- **DOM parsing contract (`packages/editor-prosemirror/src/schema.ts:30`)** — Parse guards reject invalid triggers and missing attributes, ensuring only normalized tag spans enter the editor state.
- **Schema tests (`packages/editor-prosemirror/src/schema.test.ts:1`)** — New unit tests confirm the mark registration, attribute set, and DOM round-trip behaviour so downstream plugins can rely on the schema contract.

## Step 4 — Detect Trigger Characters

- **Tag trigger plugin (`packages/editor-prosemirror/src/tagPlugin.ts:1`)** — Introduced a dual-trigger ProseMirror plugin that watches for `#`/`@`, normalises callbacks into a shared options surface, and exposes helpers to mark commits/cancels without duplicating inline trigger logic.
- **Editor wiring (`packages/editor-prosemirror/src/index.ts:225`)** — Collaborative editor now mounts the tag plugins alongside wiki link and mirror plugins, surfaces setters/getters on the public API (`setTagOptions`, `getTagTrigger`), and adds transactional helpers for suggestion commit/cancel.
- **Unit coverage (`packages/editor-prosemirror/src/tagPlugin.test.ts:1`)** — Tests exercise trigger activation for both characters and ensure `markTagTransaction` resets plugin state, preventing regressions in debounce logic when the UI closes the popover.

## Step 5 — Build Tag Suggestion UI

- **React suggestion hook (`apps/web/src/outline/hooks/useTagSuggestionDialog.ts:1`)** — Added a registry-aware dialog controller that debounces queries via `useDeferredValue`, filters entries per trigger character, and exposes caret anchors plus keyboard handlers through the shared inline trigger infrastructure.
- **Popover component (`apps/web/src/outline/components/TagSuggestionDialog.tsx:1`)** — Reused the generic `InlineTriggerDialog` to render a caret-anchored list with keyboard and pointer support while keeping TanStack Virtual unaffected.
- **Editor integration (`apps/web/src/outline/ActiveNodeEditor.tsx:296`)** — Wired the new dialog into `createCollaborativeEditor` using the tag trigger plugin, surfaced `setTagOptions`/`getTagTrigger` from the shared editor, and ensured escape/enter/arrow keys flow through the unified inline trigger hook.

## Step 6 — Handle Tag Selection

- **Atomic insertion (`packages/editor-prosemirror/src/index.ts:520`)** — Added `applyTag`, replacing the trigger slice with a `tag` mark, appending a trailing space, and touching the registry in one Yjs transaction so undo captures the full operation.
- **Registry helpers (`packages/client-core/src/doc/tags.ts:144`)** — Extracted shared mutation logic and introduced `touchTagRegistryEntryInScope` for call-sites that already hold a transaction.
- **Web adapter (`apps/web/src/outline/ActiveNodeEditor.tsx:368`)** — Tag suggestions now call `editor.applyTag`, closing the dialog once the mark lands and keeping focus inside the editor.

## Step 7 — Render Tag Pills

- **Read-only styling (`packages/client-react/src/outline/components/OutlineRowView.tsx:127`)** — Inline spans with a `tag` mark render as pills using shared palette values so static rows mirror the editing surface.
- **Editor theming (`packages/editor-prosemirror/src/index.ts:63`)** — The injected stylesheet now styles `[data-tag="true"]` spans, giving the live ProseMirror view the same pill appearance.

## Step 8 — Backspace & Editing Recovery

- **Trigger rollback (`packages/editor-prosemirror/src/tagPlugin.ts:138`)** — Backspacing over a tag pill replaces it with plain text, rehydrates the inline trigger state, and re-emits `onStateChange` so the suggestion menu reopens.
- **Inline trigger meta (`packages/editor-prosemirror/src/inlineTriggerPlugin.ts:19`)** — Extended plugin metadata with a `reopen` action, letting auxiliary plugins restore active trigger state without cancel/commit hacks.
- **Regression tests (`packages/editor-prosemirror/src/index.test.ts:246`)** — Added coverage for applying tags and reverting them with backspace to guard against future regressions.
