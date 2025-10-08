# Session State Specification

This note documents the per-device session store that powers pane layout, selections, and other
transient UI affordances. The goal is to keep multi-pane behaviour consistent across web, desktop,
and mobile adapters while ensuring the shared Yjs outline remains authoritative for structural
data.

## Implementation Plan

Follow these steps sequentially. Each step names the primary files to touch so an LLM can queue edits safely.

### 1. Revise session schema
- Bump `SESSION_VERSION` and extend `SessionPaneState` with pane-local fields (`activeEdgeId`, `selectionRange`, `collapsedEdgeIds`, `pendingFocusEdgeId`, `search`).
- File focus: `packages/sync-core/src/sessionStore.ts`, corresponding tests under `packages/sync-core/src/sessionStore.test.ts`.
- Update `defaultSessionState()` to seed the new fields and ensure `createSessionStore()` clones them correctly.

### 2. Migrate stored state
- Extend `normaliseState()` to translate legacy payloads (`selectedEdgeId`) into the first pane’s `activeEdgeId` and initialise any missing arrays.
- Add regression tests covering mixed-version hydration (fresh state, v1 payloads, malformed input).

### 3. Share pane selectors
- Introduce a helper in `packages/client-core` that merges an `OutlineSnapshot` with a `SessionPaneState` to emit rows—including pane-local collapse overrides and quick filters.
- Keep the helper pure and memo-friendly; add unit tests alongside the helper.

### 4. Expose pane-aware hooks
- Extend `apps/web/src/outline/OutlineProvider.tsx` to surface a pane registry (`usePaneState(paneId)`) backed by the session store.
- Ensure awareness syncing only reads the currently active pane’s `activeEdgeId` to keep UndoManager history clean.

### 5. Refactor outline view
- Update `apps/web/src/outline/OutlineView.tsx` to accept a `paneId` prop.
- Route selection, collapse, and focus mutations through the session store instead of calling `toggleCollapsedCommand` directly unless persisting shared state.
- Instantiate TanStack Virtual per pane to preserve virtualization performance.

### 6. Pane layout UI
- Implement a `PaneLayout` component that renders panes left-to-right with resizable gutters and respects spec shortcuts (Shift/Ctrl + click).
- Make sure pane addition/removal updates the session store and focuses the right pane.

### 7. Tests and docs
- Expand unit tests for session migrations, pane selectors, and OutlineProvider hooks.
- Add integration coverage that exercises multi-pane focus/selection flows without mutating Yjs directly.
- Update architecture docs (`docs/architecture/outline-data-model.md`, `docs/architecture/workspace.md`) if helper locations change.

### 8. Verification
- Run `npm run lint && npm run typecheck && npm test` before marking the task complete per `AGENTS.md`.
- Manually smoke-test multi-pane interactions (open/close, selection isolation, modifier clicks).

## Responsibilities
- Persist pane layout and active selection between reloads without leaking platform APIs into
  shared packages.
- Scope UI state to the user session so remote collaborators never see pane-local focus changes.
- Provide a serialisable format that can evolve safely via `SESSION_VERSION` migrations.
- Expose a narrow API (`SessionStore`) that adapters can wrap with React hooks or other reactive
  primitives.

## Storage adapter contract
The session store operates over a caller-supplied `SessionStorageAdapter` so each platform can map
to its native persistence primitive (e.g. `localStorage`, `AsyncStorage`). The adapter must:

- Return UTF-8 JSON strings from `read()` (or `null` when empty).
- Accept persisted values via `write(value: string)` synchronously.
- Propagate external updates to subscribers so multiple tabs stay in sync.
- Honour `clear()` without throwing.

## Data model
`SessionState` is versioned and copied defensively on read/write to avoid mutation leaks:

```ts
interface SessionState {
  readonly version: number; // matches SESSION_VERSION
  readonly selectedEdgeId: EdgeId | null; // temporary bridge until all panes drive selection locally
  readonly activePaneId: string; // paneId that currently owns keyboard focus
  readonly panes: readonly SessionPaneState[];
}
```

Each `SessionPaneState` captures pane-local UI affordances. Fields are keyed by stable `EdgeId`
values so mirrors remain edge-scoped per `AGENTS.md` §5.

```ts
interface SessionPaneState {
  readonly paneId: string;          // ULID generated when the pane is created
  readonly rootEdgeId: EdgeId | null; // subtree focus (null means full outline)
  readonly activeEdgeId: EdgeId | null; // primary selection for keyboard ops
  readonly selectionRange?: {
    readonly anchorEdgeId: EdgeId;
    readonly headEdgeId: EdgeId;
  };
  readonly collapsedEdgeIds: readonly EdgeId[]; // pane-local collapse overrides
  readonly pendingFocusEdgeId?: EdgeId | null;   // mirrors soft focus without stealing selection
  readonly search: {                            // pane-scoped search/session metadata
    readonly draft: string;                     // raw input from the search field
    readonly submitted: string | null;          // last executed query string (null when none)
    readonly isInputVisible: boolean;           // mirrors UI toggle for the search input
    readonly resultEdgeIds: readonly EdgeId[];  // frozen search result ordering
    readonly manuallyExpandedEdgeIds: readonly EdgeId[];   // overrides to reveal hidden children
    readonly manuallyCollapsedEdgeIds: readonly EdgeId[];  // overrides to re-collapse expanded nodes
    readonly appendedEdgeIds: readonly EdgeId[];           // newly created edges shown despite filters
  };
  readonly focusPathEdgeIds?: readonly EdgeId[]; // ordered edges from root to focused edge
  readonly focusHistory: readonly {
    readonly rootEdgeId: EdgeId | null;
    readonly focusPathEdgeIds?: readonly EdgeId[];
  }[];
  readonly focusHistoryIndex: number;           // index of the active focusHistory entry
}
```

Additional per-pane flags (e.g. scroll offsets, inline tool state) should be added here rather
than coupling them to the React view. Keep arrays small—callers should debounce high-volume
updates (AGENTS.md §7).

`focusHistory` captures the chronological navigation stack for the pane so adapters can render
back/forward controls without re-deriving state from breadcrumbs. When the user focuses a new
node (or clears focus) we append an entry and truncate any future entries, mirroring browser
history semantics. `focusHistoryIndex` points at the current entry; stepping backward or forward
only mutates the index while keeping the recorded trail intact.

## Store lifecycle
The `createSessionStore()` helper lives in `packages/sync-core/src/sessionStore.ts` and exposes a
minimal API:

- `getState()` – returns a frozen clone of the current state.
- `update(updater)` – accepts a pure function and persists the returned value if it differs.
- `setState(next)` – writes a complete state snapshot (useful for migrations).
- `subscribe(listener)` – registers a callback for local or external adapter changes.

All writes flow through `persist()`, which serialises the state and stores the string via the
adapter. Subscribers rehydrate via `normaliseState()` so malformed data falls back to defaults
instead of crashing the UI.

## Versioning & migration
`SESSION_VERSION` gates compatibility. When the schema changes:

1. Bump the constant.
2. Extend `normaliseState()` to translate older versions into the new structure (e.g. map legacy
   `selectedEdgeId` into the first pane’s `activeEdgeId`).
3. Provide sensible defaults for new fields so panes remain usable even if the adapter still holds
   stale data.

Adapters should never rely on implicit defaults—always call `defaultSessionState()` when no stored
state exists.

## Pane behaviour
Multi-pane workflows layer on top of this store:

- Creating a pane appends a new `SessionPaneState` with a ULID `paneId` and inherited focus
  context.
- Closing a pane removes its entry; if it was the active pane, adapters must promote a neighbour
  and update `activeEdgeId` accordingly.
- Per-pane collapse overrides live in `collapsedEdgeIds`. Use helpers in `@thortiq/client-core`
  to merge these flags with the shared outline snapshot before rendering rows.
- Keyboard selection updates write to `activeEdgeId` and `selectionRange` only for the pane that
  triggered the interaction. Other panes remain unaffected.
- Focus broadcasts to awareness should read from the active pane only, keeping remote undo history
  uncluttered (AGENTS.md §6).
- Call `focusPaneEdge()` and `clearPaneFocus()` when mutating `rootEdgeId` so `focusPathEdgeIds`
  stay aligned with breadcrumb rendering logic.

## Implementation notes
- Yjs document state remains the single source of truth for structure; session data only influences
  presentation. Never mutate the document inside session helpers.
- Keep logic composable (§17): shared helpers that translate `SessionPaneState` + snapshot into a
  renderable view belong in shared packages so platform adapters reuse them.
- Avoid array indices for identity (§11); panes and selections must use deterministic IDs.
- Tests that cover migrations and helper utilities live alongside the session store in
  `packages/sync-core` and should exercise multi-pane scenarios.

## Related documents
- [Outline Data Model](./architecture/outline-data-model.md) – details the Yjs schema consumed by
  session selectors.
- [Workspace Overview](./architecture/workspace.md) – explains how shared packages expose session
  helpers to platform adapters.
- [Thortiq Spec §6](./thortiq_spec.md) – product requirements for panes and modifier behaviour.
