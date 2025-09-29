# Sync Manual Verification Checklist

These checks were run while completing Step 9 of `docs/sync_server_plan.md` to ensure the sync
manager and preview tooling behave as expected. Re-run the relevant subset when touching sync,
persistence, or the preview harness.

## Preview Scenarios
- `pnpm preview` → verify each card loads:
  - **Seed Outline** – confirm keyboard navigation inserts/indents nodes and the presence badge hides
    when only the local client is active.
  - **Deep Hierarchy** – scroll through nested phases; ensure virtualisation keeps performance stable
    and collapsing a branch reflows correctly.
  - **Collapsed Branch** – root starts collapsed; expanding reveals backlog nodes seeded for QA.

## Resilience Behaviours
- `pnpm test --filter "SyncManager"` (already covered by CI) – observe reconnection logs while tests
  patch `navigator.onLine` to ensure offline detection pauses retries.
- Manual smoke: in the preview, toggle DevTools → Network offline and back online; presence banner
  should drop and reconnect without page reload.

## Build & Quality Gates
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `pnpm build` (confirms both `index.html` and `preview.html` bundles build successfully; current
  warning highlights `OutlineView` chunk size >500 kB, acceptable for now but worth revisiting once
  we add route-based code splitting).

## Open Risks
- Bundle size warning (~510 kB) suggests future work to split editor/preview code paths.
- Desktop & mobile adapters still rely on TODO smoke tests for real device integration; ensure they
  are exercised when those shells are implemented.
