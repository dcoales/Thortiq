# Rich‑Text Editor Migration Plan (Lexical adapter, swappable design)

## Goals
- Keep formatting visible while editing (bold/italic/colors/background, inline links).
- Wikilinks render as underlined, clickable spans during and outside editing.
- Single‑click anywhere in node text immediately enters edit mode with the caret placed exactly where clicked — no flicker or layout shift.
- Preserve AGENTS.md constraints: Yjs transactions only, unified undo, virtualization performance, SOLID/composable design, stable IDs.
- Architecture allows swapping the editor (e.g., ProseMirror) with minimal changes via an adapter.

## High‑Level Architecture
- Add a platform‑agnostic `IRichTextAdapter` in `packages/client-core/src/richtext/` describing the editor contract (mount, update, selection, serialization, events).
- Implement `WebRichTextAdapterLexical` using Lexical + yjs binding for the web/desktop shell.
- Keep non‑editing rows as read‑only HTML (current `row.node.html` rendering) for maximal performance.
- For the active row, render a rich editor over the same area with identical typography so the text does not move.
- Wikilinks are first‑class inline nodes in the adapter; click delegates to OutlinePane navigation.

## Constraints & Invariants
- Never mutate text/structure outside Yjs transactions (CommandBus handles all writes).
- Unified history via a single UndoManager; remote changes should not enter local undo.
- Mirrors are edges; no change needed in this migration.
- Virtualize rows; mount the rich editor only for the active row.
- Stable IDs; inline nodes reference target node by NodeId.

## Step‑By‑Step Plan

1) Define Adapter Contract (shared)
- Add `packages/client-core/src/richtext/adapter.ts` with:
  - `mount(container: HTMLElement, opts: AdapterMountOptions): Unmount`.
  - `setHtml(html: string): void` and `getHtml(): string`.
  - `focusAt(point: {x: number; y: number}): void` and `setSelection(offset: number): void`.
  - `onChange(cb: (html: string, plainText: string) => void): Unsubscribe`.
  - `insertWikiLink(data: {targetNodeId: string; display: string}): void`.
  - `destroy(): void`.
- Include concise module comments describing responsibilities and invariants (no Yjs ops directly).

2) Web Adapter (Lexical)
- Add `packages/client-core/src/richtext/web-lexical/` implementing `IRichTextAdapter` with:
  - Lexical editor setup, theme that matches existing typography.
  - `lexical-yjs` binding to a Yjs `Text` for live collaboration.
  - Serializer to/from HTML consistent with existing `node.html` semantics (line breaks, escaping).
  - Marks: bold, italic, color, background (as marks/inline styles) mapped to HTML spans.
  - `WikiLinkNode` with attrs `{targetNodeId, display}` renders `<span data-wikilink="true" data-target-node-id="..." class="thq-wikilink">display</span>` and underlined style.
  - Click handler inside the node that calls an adapter `onLinkClick(targetNodeId)` callback.

3) Adapter → CommandBus/Yjs
- NodeEditor will not perform DOM surgery. On adapter change events, call `bus.execute({ kind: 'update-node', nodeId, patch: { html, updatedAt } })`.
- Plain text syncing remains centralized in `CommandBus.applyUpdateNode` via existing `htmlToPlainText` logic (no duplicate conversions inside the adapter for persistence).
- Ensure local origin tagging for undo (LOCAL_ORIGIN) and exclude remote edits from local undo stack.

4) Click‑to‑Edit With No Flicker
- Keep read‑only HTML visible by default for all rows.
- On click inside a row’s text area:
  1. Compute click coordinates and DOM Range/offset using `document.caretRangeFromPoint`/`caretPositionFromPoint` (with fallbacks).
  2. Measure the text container rect.
  3. Mount the adapter editor as an absolutely‑positioned element on top of the same container (same width/height), sharing typography class (e.g., `.thq-node-text`).
  4. Call `adapter.setHtml(node.html)` and then `adapter.focusAt({x, y})` to position caret precisely.
  5. In the next animation frame, hide the read‑only HTML (e.g., `visibility: hidden`) to avoid reflow during placement. Unhide again when editor unmounts.
- Ensure identical CSS for both layers:
  - Same font family/size/weight, line-height, white-space, letter-spacing, paddings, and colors.
  - Define a shared class used by both static HTML and the editor content host.

5) NodeEditor Integration
- Replace the current `textarea` path with a composition:
  - `NodeTextView` (read‑only) renders `node.html` for all non‑active rows.
  - `RichNodeEditor` mounts the adapter only when the row is active.
- Editing activation flow:
  - OutlinePane tracks active/focused edge id (already exists).
  - On click in a non‑active row, set that row active and pass click coordinates to `RichNodeEditor` via a focus directive. `RichNodeEditor` mounts and calls `focusAt`.
  - Keep selection preservation logic (already implemented) but route to adapter.

6) Wikilink Trigger Inside Editor
- Port the `[[` detection into a Lexical plugin:
  - Reuse `findActiveWikiTrigger` to detect triggers.
  - Debounce `findWikiCandidates` lookup.
  - On selection, call `adapter.insertWikiLink({targetNodeId, display})`.
- For read‑only view, OutlinePane’s existing container click handler on `[data-wikilink="true"]` continues to navigate.

7) Style Parity & Layout Stability
- Introduce a single source of truth CSS token set for text metrics in `packages/client-core/src/styles/typography.css` (or TS style constants) applied to both static and editor layers.
- Verify line break semantics (HTML `<br />` vs. editor line nodes) are identical; adjust serializer to preserve existing behavior.
- Disable transitions/animations on mount to avoid visible flicker.

8) Swappability (Future ProseMirror)
- Keep `IRichTextAdapter` small and stable.
- Add `WebRichTextAdapterProseMirror` later in `richtext/web-prosemirror/` using `y-prosemirror`.
- NodeEditor should only import the interface and inject the concrete adapter via a factory (platform adapter pattern) so swap is one place.

9) Performance & Virtualization
- Mount a single editor instance for the active row; unmount on blur/selection change.
- Consider an editor pool (size 1–2) to reuse instances on quick navigation.
- Debounce expensive operations in plugins; never recompute full document on keystroke.
- Keep VirtualizedOutline unchanged; editor is contained within the row’s DOM and sized by the row’s box.

10) Testing & Validation
- Unit tests (shared):
  - Adapter selection/serialization parity with existing HTML.
  - WikiLinkNode rendering and click callback.
- Integration tests:
  - Click‑to‑edit places caret where clicked (simulate point, assert selection).
  - No flicker: mount editor on top of static HTML and hide static view after first frame (visual diff not required; assert DOM order/state changes and bounding rect equality).
  - Wikilink insertion via `[[` and selection; spans clickable; navigation works; history preserved.
  - Undo/redo of text changes stays in unified undo; remote updates do not enter local undo.
- Add test hooks to expose selection offsets if needed behind a feature flag for testing.
- Run: `npm run lint && npm run typecheck && npm test`.

## Rollout Strategy
- Phase 1: Land adapter interfaces, no behavior change.
- Phase 2: Implement Lexical adapter and `RichNodeEditor`, keep behind a feature flag.
- Phase 3: Enable for a subset of tests; validate no regressions.
- Phase 4: Replace textarea path; keep ProseMirror path as future alternative.

## Risks & Mitigations
- Caret mapping precision:
  - Use DOM range APIs; add fallback mapping by traversing text nodes.
  - Keep identical typography class to ensure pixel‑perfect mapping.
- HTML/Editor serialization mismatch:
  - Add round‑trip tests and snapshot corpus for tricky cases (nested spans, colors, line breaks).
- Performance under large docs:
  - Ensure plugins are lightweight; mount one editor only; debounce candidate search.

## References
- `packages/client-core/src/components/OutlinePane.tsx` — focus, navigation, container click handler for wikilinks.
- `packages/client-core/src/wiki/*` — parse/render helpers for wikilinks (to be leveraged in adapter serializer).
- `packages/client-core/src/commands/commandBus.ts` — only route for Yjs mutations; keep unified undo.

