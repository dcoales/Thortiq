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
