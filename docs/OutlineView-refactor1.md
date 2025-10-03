# OutlineView Refactor Phase 4 Breakdown

## Context
This plan refines Phase 4 of `docs/refactor1.md` so each extraction from `apps/web/src/outline/OutlineView.tsx` can be completed and validated before advancing. Steps align with the target layering in `docs/architecture/outline_refactor.md` and preserve shared-first, transaction-safe behaviour.

## Step Plan
1. **Baseline Harness & Metrics**  
   - Snapshot current behaviour: capture OutlineView render metrics, selection flows, drag/drop happy paths using existing integration tests or new smoke tests in `apps/web/src/outline/__tests__/OutlineView.baseline.test.tsx`.  
   - Record file size + dependency graph before changes to verify reduction later.  
   - Baseline artefacts: see `apps/web/src/outline/__tests__/OutlineView.baseline.test.tsx` for the harness and `docs/metrics/OutlineView-baseline.json` / `docs/OutlineView-baseline.md` for recorded metrics.  
   - Tests: `npm run lint`, `npm run typecheck`, targeted `npm test -- OutlineView` (or equivalent focused suite).

2. **Extract `useOutlineRows` (data shaping)**  
   - Move row derivation, quick filter application, and focus context prep into `packages/client-react/outline/useOutlineRows.ts`. Keep pure data transforms delegating Yjs access to Phase 1 outputs.  
   - Add unit tests around pagination/virtualization boundaries with fixture documents in `packages/client-react/outline/__tests__/useOutlineRows.test.ts`.  
   - Tests: `npm run lint`, `npm run typecheck`, `npm test -- useOutlineRows`.

3. **Extract `useOutlineSelection` (selection/session bridge)**  
   - Consolidate selection state derivation and session mutations currently inline at lines 123-210 into `packages/client-react/outline/useOutlineSelection.ts`. Ensure mutations still run within `withTransaction`.  
   - Provide hook-level tests using mocked session store adapters to validate multi-node selection, cursor focus, and undo history tagging.  
   - Tests: `npm run lint`, `npm run typecheck`, `npm test -- useOutlineSelection`.

4. **Extract `useOutlineDragAndDrop` (intent + orchestration)**  
   - Move drag intent handling, indicator state, and `moveEdge` orchestration (lines 430-520) into a shared hook that accepts platform pointer adapters.  
   - Guard against cycles by delegating to `doc/edges` helpers from Phase 1; confirm no DOM mutation happens outside hook outputs.  
   - Tests: extend existing drag/drop suites with new hook unit tests plus a focused integration test using React Testing Library to assert drop outcomes. Run `npm test -- dragAndDrop` alongside lint/typecheck.

5. **Componentize `OutlineRowView` & `PresenceIndicators`**  
   - Create presentational components under `packages/client-react/outline/components/` that consume the extracted hooks.  
   - Verify mirrors/edge state remains edge-local by asserting props contain edge-level metadata rather than node IDs alone.  
   - Tests: component snapshot/interaction tests (`npm test -- OutlineRowView`), ensure lint/typecheck pass.

6. **Introduce Shared Command Layer**  
   - Extract keyboard shortcut orchestration near `useOutlineCursorManager` into `packages/client-core/commands/outlineCommands.ts`, exposing platform-agnostic command descriptors.  
   - Add unit tests covering command routing, modifier handling, and conflict resolution.  
   - Tests: `npm run lint`, `npm run typecheck`, `npm test -- outlineCommands`.

7. **Implement `OutlineVirtualList` Adapter**  
   - Wrap virtualization logic into `packages/client-react/outline/OutlineVirtualList.tsx` so DOM measurement stays localized; ensure hooks provide only row data.  
   - Bench basic performance via jest fake timers or profiling snapshots to confirm virtualization thresholds.  
   - Tests: component tests simulating large document (e.g., 10k nodes) verifying windowing boundaries + scroll sync; lint/typecheck.

8. **Recompose `OutlineView` and Final Integration Pass**  
   - Replace legacy inline logic with the new hooks/components, keeping file under 750 lines and ensuring provider contracts remain unchanged.  
   - Update docs (`docs/architecture/outline_refactor.md`) if API surfaces differ and ensure mirrors/edge state rules remain documented.  
   - Tests: full `npm run lint && npm run typecheck && npm test`, plus targeted integration suites (`npm test -- OutlineView` and drag/selection scenarios) before marking Phase 4 complete.