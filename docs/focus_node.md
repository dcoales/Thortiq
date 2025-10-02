# Focus Node Implementation Plan

## Scope
Design and implement the outline "focus node" behaviour described in section 4.1.1 of `docs/thortiq_spec.md`. The plan keeps Thortiq aligned with `AGENTS.md` operational rules (transactional Yjs mutations, SOLID composition, virtualization, shared-first architecture).

## Step-by-step
1. **Audit current outline stack**
   - Review `packages/client-core` selectors and snapshot builders plus `apps/web/src/outline/OutlineView.tsx` to catalogue how `pane.rootEdgeId`, indentation, guidelines, drag/drop, selection, and virtualization currently behave.
   - Confirm existing tests in `packages/client-core` and `apps/web` cover multi-root rendering so we can extend them for focus scenarios.

2. **Model focus state in shared selectors**
   - Extend `buildPaneRows` (or add a dedicated helper) to support a focused edge: capture both actual tree depth and display depth so UI can render root children without indentation while still resolving ancestor relationships for guidelines/drop zones.
   - Ensure mirrors keep edge identity (`AGENTS.md` rule 5) by storing focus via `EdgeId`, never via node index.

3. **Compute breadcrumb data in shared code**
   - Add pure helpers in `packages/client-core` to derive the ancestor path for a focused edge from the snapshot, returning stable IDs and display labels.
   - Include truncation metadata (indices to hide behind ellipses) so UI layers stay thin adapters per the shared-first guideline.

4. **Session state transitions for focusing**
   - Introduce intent-specific actions (e.g., `focusEdge`, `clearFocus`) in the session store or a thin adapter so focus changes update `pane.rootEdgeId` inside a single `sessionStore.update` call.
   - Guard against stale references by automatically clearing focus if the target edge disappears (mirrors deleted/moved), without mutating Yjs outside transactions.

5. **Bullet interaction wiring**
   - In `OutlineView`, add an event handler that wraps bullet clicks in a debounced callback which sets the pane focus via the new session action and cancels inline edit activation.
   - When entering focus, maintain Undo history isolation by using session state only; structural doc changes must still go through existing Yjs helpers.

6. **Focus header rendering**
   - Create a small composable component (e.g., `FocusHeader`) that shows the focused node text (read-only HTML) and optional metadata, omitting expand/collapse UI.
   - Ensure the focused node text hydrates from snapshot data and reuses existing read-only renderer so switching between focused/unfocused modes is visually seamless.

7. **Breadcrumb UI with ellipsis dropdown**
   - Render breadcrumb items inside the outline header using the computed path helper, falling back to the document-level label when `rootEdgeId` is null.
   - Implement overflow handling: measure available width, collapse middle ancestors to an ellipsis button, and surface a lightweight dropdown listing the hidden nodes. Keep this logic in a dedicated hook/component for reuse across platforms.

8. **Row virtualization + layout adjustments**
   - Update row rendering to treat focused root children as depth 0 (no indentation) while leaving virtualization and measurement intact (TanStack row heights constant per AGENTS rule 7).
   - Update guideline and drag-drop calculations so they continue to map to the true ancestor chain even when some ancestors aren't rendered above the focus header.

9. **Breadcrumb navigation + escape hatches**
   - Wire breadcrumb clicks to update focus (including "document" root) and ensure keyboard shortcuts or context menus can clear focus. Respect unified history by keeping focus navigation in session state only.

10. **Testing + QA**
    - Add unit tests for the new shared helpers (breadcrumb path, focused rows) under `packages/client-core`.
    - Extend `OutlineView.test.tsx` (and any relevant Playwright/Cypress equivalent) to cover focusing, breadcrumb truncation, and drag/drop behaviour while focused.
    - Document manual QA steps to validate ellipsis dropdown, virtualization stability, and persistence of focus across reloads.

## Verification Checklist
- `npm run lint`
- `npm run typecheck`
- `npm test`
