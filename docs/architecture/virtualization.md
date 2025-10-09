# Outline Virtualisation Strategy

The web outline renders thousands of nodes without sacrificing interaction latency by pairing immutable snapshots with
[TanStack Virtual](https://tanstack.com/virtual). Rows are flattened from the shared Yjs document and projected into a
virtual list so React only mounts the items that are visible (plus a small overscan buffer).

## How it Works
- `createOutlineSnapshot()` converts the shared document into immutable maps (`nodes`, `edges`, `childEdgeIdsByParentEdge`, `canonicalEdgeIdsByEdgeId`) so mirrors project their own child edge ids.
- `buildPaneRows()` walks the snapshot depth-first, producing `OutlineRow` descriptors keyed by the **projected edge id**. The canonical id is carried alongside each row so commands/Undo can deduplicate when required.
- `useVirtualizer()` manages row measurement; the container supplies a stable height (`ESTIMATED_ROW_HEIGHT`) and falls
  back to DOM measurement when needed via `measureElement`.
- Collapsing/expanding nodes never mutates DOM directly—`toggleEdgeCollapsed` writes edge-local state inside a Yjs
  transaction, the snapshot refreshes, and the virtualiser recalculates offsets.
- Search mode and other large list transitions (e.g. filters) call `virtualizer.measure()` after a change so TanStack
  flushes stale heights. The shared `OutlineVirtualList` component now exposes an `onVirtualizerChange` callback that
  returns the live virtualiser instance when windowing is enabled. Platform shells cache the handle and invoke
  `measure()` whenever result sets change (`OutlineView` does this after search submissions) to avoid jumpy scroll
  positions.

## Authoring Guidelines
- Batch expensive recomputations. If you need derived indexes for features (search, filters), cache them against the
  immutable snapshot instead of recalculating on every render.
- Avoid synchronous DOM reads during pointer/keyboard events. The virtualiser already measures rows when necessary;
  additional `getBoundingClientRect()` calls belong behind `requestAnimationFrame` if absolutely required.
- Keep row height reasonably consistent. When adding new UI (badges, presence), prefer flex layouts over absolute
  positioning so the virtualiser measurements stay accurate.
- Right-rail affordances (mirror tracker badges, presence indicators) should live in the existing row flex rail so the
  measurement heuristics account for them without reflow hacks.
- Never mutate the flattened data structure in-place—always derive from `OutlineSnapshot` inside React memo hooks.
- When triggering re-measure, prefer event-driven hooks (store subscriptions, search submissions) rather than timers.
  Cache the virtualiser handle via `onVirtualizerChange`, guard against `null` when virtualization is disabled, and
  debounce manual calls if you are reacting to high-frequency events.

## Debugging Tips
- Enable the preview gallery (`pnpm preview`) to inspect deep trees and collapsed states without relying on the live
  sync server.
- When tuning overscan or measurement heuristics, use the fake data scenarios in the preview page to validate scroll
  behaviour across long documents.

By respecting these rules we preserve smooth scrolling while still benefiting from the shared document model and unified
undo history.
