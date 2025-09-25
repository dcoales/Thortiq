# Thortiq AGENTS Compliance Review
_Intended location: `docs/agents_compliance_review.md`_

## Overview
- Core document mutations flow through `CommandBus` and shared Yjs helpers, so transaction safety is mostly preserved.
- Platform shells and virtualization logic diverge from the shared-first and SOLID guidance, introducing duplication and scale risks.
- UI currently matches specs, but several architecture rules require remediation to stay compliant as the project grows.

## Rule Deviations

- **Rule 10 & 13 – Shared-first seeding (High)**  
  - Location: `apps/web-app/src/components/App.tsx:25`, `apps/desktop-shell/src/components/App.tsx:17`  
  - Notes: Both shells duplicate outline bootstrapping logic with divergent defaults. The desktop app bypasses `ensureDocumentRoot`, so shared code cannot rely on the canonical root node and seeded content drifts across platforms.

- **Rule 14 – Platform adapters (High)**  
  - Location: `apps/web-app/src/components/App.tsx:119`, `apps/web-app/src/components/App.tsx:233`, `apps/web-app/src/components/App.tsx:299`, `apps/web-app/src/components/App.tsx:326`  
  - Notes: Direct usage of `window`, `localStorage`, `fetch`, timers, and DOM APIs lives inside the web `App` component. Without an adapter interface, the shared core cannot reuse sync/bootstrap behaviour and the desktop/mobile shells cannot participate without duplicating logic.

- **Rule 8 & 17 – SOLID / composability (High)**  
  - Location: `packages/client-core/src/components/OutlinePane.tsx:78`, `packages/client-core/src/components/OutlinePane.tsx:243`, `packages/client-core/src/components/OutlinePane.tsx:413`, `packages/client-core/src/components/OutlinePane.tsx:525`  
  - Notes: `OutlinePane` mixes breadcrumbs, history navigation, drag-preview DOM work, selection orchestration, and focus restoration in a single component. This violates single-responsibility guidance and makes reuse across platforms difficult.

- **Rule 7 – Virtualize rows at scale (High)**  
  - Location: `packages/client-core/src/virtualization/outlineRows.ts:32`, `packages/client-core/src/yjs/doc.ts:118`  
  - Notes: Every outline recalculation clones the entire edge map via `createResolverFromDoc` and `toArray()`. For large trees this becomes O(n) per doc update, undermining the virtualization requirement.

- **Rule 10 – DRY constants (Low)**  
  - Location: `packages/client-core/src/virtualization/outlineRows.ts:33`  
  - Notes: The nodes collection key is hard-coded as `'nodes'` instead of reusing `NODES_COLLECTION`, risking drift from other modules.

- **Rule 15 – Module intent comments (Medium)**  
  - Location: `packages/client-core/src/commands/commandBus.ts:1`, `packages/client-core/src/components/OutlinePane.tsx:1`, `packages/client-core/src/components/VirtualizedOutline.tsx:1`, `packages/client-core/src/components/NodeEditor.tsx:1`, `packages/client-core/src/selection/selectionManager.ts:1`  
  - Notes: Key modules lack the brief intent comments mandated by AGENTS.md, increasing onboarding friction and making future refactors riskier.

## Refactoring Plan

1. **Extract shared outline bootstrap utility** (rules 10, 13)  
   - Actions: Move seed logic into `packages/client-core/src/bootstrap/initialOutline.ts` with an idempotent helper that uses `DOCUMENT_ROOT_ID`. Update web and desktop shells to call it (or accept shared defaults) and remove inline duplication.  
   - Tests to add:  
     - Unit test verifying the helper only seeds when the root has no children (`packages/client-core/src/__tests__/initialOutline.test.ts`).  
     - Extend `packages/client-core/src/__tests__/outlineInteractions.test.tsx` to cover the shared bootstrap path.  
     - Run `npm run lint && npm run typecheck && npm test`.

2. **Introduce platform environment adapters** (rules 8, 14, 17)  
   - Actions: Define a `SyncEnvironment` interface in `packages/client-core` encapsulating storage, HTTP, timers, and bootstrap config. Provide a web implementation in `apps/web-app` and thin desktop/mobile stubs. Inject the adapter into the shells so shared logic (token persistence, profile fetch, snapshot scheduling) moves into reusable hooks/services.  
   - Tests to add:  
     - Unit tests for the adapter to ensure graceful degradation when storage/token/env vars are unavailable (`packages/client-core/src/__tests__/syncEnvironment.test.ts`).  
     - Update existing sync-related tests to mock the adapter instead of the global environment.  
     - Re-run `npm run lint && npm run typecheck && npm test`.

3. **Modularize OutlinePane responsibilities & document intent** (rules 8, 15, 17)  
   - Actions: Split `OutlinePane` into composable hooks/components (e.g., `useOutlineFocusHistory`, `useBreadcrumbLayout`, `useDragPreview`, `OutlineTreeView`). Add concise module-level comments describing each module’s role, invariants, and key inputs/outputs.  
   - Tests to add:  
     - Focus history regression tests extending `packages/client-core/src/__tests__/outlinePane.test.tsx` to assert navigation state after back/forward actions.  
     - New hook-level tests (e.g., `useBreadcrumbLayout`) that run without DOM globals.  
     - Execute `npm run lint && npm run typecheck && npm test`.

4. **Optimize outline virtualization and remove hard-coded keys** (rules 7, 10)  
   - Actions: Replace the full-map clone in `buildOutlineRowsSnapshot` with an incremental resolver that listens to Yjs array events, re-indexing only affected subtrees. Use shared constants (`NODES_COLLECTION`) for all collection access.  
   - Tests to add:  
     - Performance-oriented unit test that simulates a tree (~5k nodes) and asserts snapshot rebuilds skip untouched branches (can instrument with a counter rather than timing).  
     - Regression tests confirming collapsed edge handling still behaves after the optimization.  
     - Run `npm run lint && npm run typecheck && npm test`.

5. **Document architecture shifts and adapter contracts** (rules 14, 18)  
   - Actions: Capture the new environment adapter design and outline flow in `docs/architecture/platform-adapters.md`, referencing it from task/PR notes. Ensure new modules carry module-level comments per rule 15.  
   - Tests/verification: Documentation lint (if configured) plus the standard `npm run lint && npm run typecheck && npm test` suite.

## Additional QA Recommendations
- After refactors, exercise the outline UI manually on large synthetic trees to validate virtualization and drag/drop remain smooth.
- Verify undo/redo history still excludes remote updates by simulating websocket sync with the new adapter layer.
- Ensure platform shells (desktop/mobile) bootstrap identical seed content and that mirrors/edge state remain consistent across adapters.
