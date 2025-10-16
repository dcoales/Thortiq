# Multi-Pane Outline Architecture

## Intent
Thortiq now supports viewing the outline in multiple side-by-side panes. Each pane renders its own virtualised outline viewport while sharing a single ProseMirror editor instance to respect AGENTS rule 20. This document records how pane state is modelled, how runtime metadata flows through the client packages, and where cross-pane interactions live so future work (pane presets, synced scrolling, etc.) can build on the same foundation.

## Key modules
- `packages/client-core/src/panes/paneCommands.ts`  
  Pure reducers that manipulate `SessionState` pane data (`paneOrder`, `panesById`, `activePaneId`, `selectedEdgeId`). Helpers include `openPaneRightOf`, `focusPane`, `ensureNeighborPane`, and `closePane`. They avoid touching runtime-only UI state, keeping UndoManager history clean.

- `packages/client-core/src/outlineStore/store.ts`  
  Hosts the shared outline store. Pane lifetime updates call the reducers above for persistent state, while `updatePaneRuntimeState` stores transient values (`scrollTop`, `widthRatio`, `lastFocusedEdgeId`, `virtualizerVersion`) outside Yjs transactions.

- `packages/client-react/src/outline/PaneManager.tsx`  
  Adapter component that renders panes based on ordered ids from the outline store. It manages responsive layout (horizontal vs. stacked), resizable gutters, independent scroll containers, and virtualizer re-measurement.

- `apps/web/src/outline/OutlineView.tsx`  
  Renders the outline for a specific pane. It consumes runtime metadata for scroll position, mirrors modifier clicks through `usePaneOpener`, and invokes `usePaneCloser` to dispose panes. Cleanup logic clears pending async work before dispatching close actions.

- `apps/web/src/outline/sharedCollaborativeEditor.ts` & `ActiveNodeEditor.tsx`  
  The shared editor manager ensures only one ProseMirror instance exists. When the active pane changes, the manager reattaches the editor to the new pane’s text container and switches nodes via `editor.setNode`.

## State & data flow
1. **Persistent pane state** lives in the session store (Yjs doc). Each pane tracks `rootEdgeId`, `activeEdgeId`, focus history, collapse state, search metadata, and the preferred `widthRatio` so clients restore their pane layout after refresh.
2. **Runtime pane state** lives alongside the outline store (`PaneRuntimeState`). It caches UI-only data such as scroll offsets, preferred width ratios (initialised from the session snapshot), and virtualizer hints so layouts remain responsive without polluting collaborative history.
3. **Actions** originate from UI modules:
   - Modifier clicks (Ctrl/Cmd or Shift on bullets/wikilinks) call `usePaneOpener`.
   - Close buttons call `usePaneCloser`.
   - Keyboard shortcuts (Ctrl/Cmd + N) or other future actions reuse the same reducers.
4. **Rendering**: `PaneManager` maps ordered ids to `OutlineView` instances. Each view forwards a stable `scrollParentRef` and notifies `PaneManager` when its virtualizer changes so gutters and responsive stacking can recompute measurements.

## Follow-up opportunities
- **Pane presets:** Allow saving/restoring pane layouts (ids, widths, focus targets) as named presets in the session document.
- **Synced scrolling:** Optional mode where related panes scroll together when comparing node branches.
- **Cross-pane search:** Surface search state for all panes in the header to make it clear which pane owns a query.

These ideas are deliberately out of scope for the current implementation but are natural extensions on top of the documented architecture.*** End Patch
