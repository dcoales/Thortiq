# Local-First Bootstrap Plan

## Objective
Implement an always-available outline experience where the web shell renders from local persistence immediately and treats network sync as best-effort background work, while respecting AGENTS.md constraints and existing shared abstractions.

## Prerequisites
1. Re-read `AGENTS.md` and the offline guidance in `docs/architecture/sync_manager.md` to keep SOLID/composition and shared-first rules top-of-mind.
2. Ensure the current branch is up to date; note any pre-existing workspace changes so they are not reverted.
3. Be ready to run `npm run lint && npm run typecheck && npm test` before finishing.

## Implementation Steps

1. **Audit the current bootstrap sequence**
   - Inspect `createOutlineStore` in `apps/web/src/outline/OutlineProvider.tsx:253` to confirm the `ready` promise awaits `sync.connect()`.
   - Review `SyncManager.connect()` in `packages/client-core/src/sync/SyncManager.ts:524` to understand why the promise never resolves when the WebSocket fails.
   - Capture current behaviour with a failing WebSocket via a quick manual run (optional smoke test) so regressions can be spotted.

2. **Decouple UI readiness from network connect**
   - In `createOutlineStore`, resolve `ready` once `sync.ready` (persistence hydration) completes instead of awaiting `sync.connect()`.
   - Replace the awaited call with a fire-and-forget invocation (`void sync.connect()` wrapped in error logging) so the store attaches listeners immediately.
   - Ensure awareness bootstrap and default seeding remain inside Yjs transactions (`seedDefaultOutline` already complies) and that no DOM work happens before React renders.

3. **Relax `SyncManager.connect()` semantics (if required)**
   - Evaluate whether other call sites rely on the promise resolving only after a successful connection.
   - If necessary, change `connectInternal` so it resolves after the initial attempt is initiated (even if the status remains `recovering`), while keeping retry scheduling untouched.
   - Add clear comments documenting the new contract (`packages/client-core/src/sync/SyncManager.ts:567`) and guard against double-connects.

4. **Expose connection status without blocking rendering**
   - Surface `sync.status` (already available) through the outline store so UI components can show “Offline / Reconnecting” states without gating the document.
   - Keep status handling composable—prefer a selector hook rather than pushing state into React context setters.

5. **Add offline regression coverage**
   - Extend `OutlineView` tests or add a new test in `apps/web/src/outline/OutlineView.test.tsx` that stubs `global.WebSocket` to throw, renders the provider, and asserts the outline loads with seeded content while status reflects a non-connected state.
   - Consider unit coverage in `packages/client-core/src/sync/SyncManager.test.ts` to ensure `connect()` resolves even when the provider never emits `connected`.

6. **Update documentation**
   - Summarise the new bootstrap flow in `docs/architecture/sync_manager.md`, highlighting that UI readiness depends on persistence, not network.
   - Cross-link this plan (and any future architecture sketch if behaviour changes materially) per rule #18.

7. **Regression checklist**
   - Run `npm run lint && npm run typecheck && npm test`.
   - Manually launch `pnpm --filter web dev` with the sync server down to verify the outline renders, and optionally confirm graceful recovery once the server starts.

## Deliverables
- Code changes in the outlined files implementing the decoupled bootstrap.
- Updated automated tests demonstrating offline start-up.
- Refreshed documentation describing the flow.
- Passing lint, typecheck, and test runs recorded in task notes.

