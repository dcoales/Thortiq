# Mirrors Implementation Plan (Spec 4.2.2)

Each step fits inside the GPT-5-codex context window and complies with AGENTS.md, especially the Yjs transaction, virtualization, and edge-local mirror rules.

1. Audit existing mirror scaffolding.
   - Review `packages/client-core/src/doc` and `packages/client-core/src/types.ts` to catalog current mirror-related fields (`mirrorOfNodeId`, edge factories, undo integration).
   - Trace how outlines hydrate in `packages/client-core` and `apps/web` to map where mirror metadata must flow without breaking virtualization or the single `UndoManager`.
   - Capture any gaps or invariants in doc comments so later steps have a definitive contract.

2. Extract shared inline trigger plumbing.
   - Study `packages/editor-prosemirror/src/wikiLinkPlugin.ts` and related dialog code in `apps/web` to understand the existing `[[` flow.
   - Factor reusable trigger/dialog scaffolding (keyboard handling, virtualization, data providers) into a shared helper so mirrors and wiki links stay DRY per AGENTS rule 10.
   - Add unit coverage ensuring the refactor preserves wiki-link behaviour before introducing mirrors.

3. Implement the mirror dialog UI shell.
   - Build a dialog component that consumes the shared trigger helper, reusing list virtualization and keyboard focus logic.
   - Ensure the data source streams candidate nodes with breadcrumb metadata, truncation, and highlighted default selection matching section 4.2.2.1.
   - Wire accessibility roles and Esc/Enter shortcuts consistently with other dialogs (section 13).
   - Notes for implementers: Step 2 introduced `createInlineTriggerPlugin` plus the `useInlineTriggerDialog` hook, which already handle trigger detection, keyboard routing, and result list management. Plug the mirror dialog into those helpers to stay DRY and prepare for virtualization reuse.

4. Wire the `((` trigger in the editor.
   - Extend the ProseMirror plugins (likely alongside the wiki link plugin) so typing `((` opens the mirror dialog via the shared helper.
   - Guarantee all document mutations happen through `withTransaction()` helpers and register the origin with the unified `UndoManager`.
   - Add regression tests verifying the caret placement and dialog invocation.
   - Notes for implementers: The shared inline trigger UI now consists of `InlineTriggerDialog`, `WikiLinkDialog`, `MirrorDialog`, and the `useMirrorDialog` wrapper (built atop `useInlineTriggerDialog`). Step 4 should reuse these primitives when wiring the new ProseMirror plugin hooks.

5. Implement mirror edge creation logic.
   - Introduce a command in `packages/client-core` that encapsulates mirror creation, handling both "convert empty bullet" and "insert new sibling" flows inside a single Yjs transaction.
   - Ensure new edges receive stable IDs via the existing ID generators (no array-index identities) and update undo/redo metadata accordingly.
   - Surface errors (e.g., missing selection) through existing command error channels without disrupting focus management.
   - Notes for implementers: The editor now exposes `getMirrorTrigger`, `consumeMirrorTrigger`, and `cancelMirrorTrigger`, while `useMirrorDialog` yields the selected candidate. Use these to remove the typed `((` sequence before applying the mirror creation transaction.

6. Enforce candidate filtering and cycle guards.
   - Update the mirror data provider to exclude edges that are already mirrors and to prevent selections that would introduce cycles (respect section 0 Terminology).
   - Add unit tests covering direct cycles, ancestor/descendant relationships, and mirrors-of-mirrors.
   - Confirm filtered sets still paginate and virtualize efficiently.

7. Support Alt+drag mirror creation.
   - Enhance `useOutlineDragAndDrop` (and shared command layer) so holding Alt duplicates the dragged edges as mirrors instead of moving them.
   - Reuse the command from step 5 to avoid divergent logic, and keep hover indicators consistent with existing drag and drop hit testing rules.
   - Verify multi-select behaviour keeps relative ordering and that undo/redo treats the transaction atomically.

8. Render mirror bullet affordances.
   - Update the outline row and bullet components to draw the 1px halo: orange for originals, blue for mirrors, without breaking the virtualization measurement.
   - Ensure collapsed parents still show the existing halo while overlaying the mirror border (per section 4.2.2.2), and add storybook or visual tests if available.
   - Maintain keyboard focus targets so the new ring does not interfere with click hit boxes.

9. Maintain child edge identity per mirror.
   - Adjust the outline data loader so each mirror instance owns distinct edge IDs for its child edges while sharing the underlying node content.
   - Audit selection, collapse state, and virtualization caches to ensure they key off edge IDs, not node IDs, preserving AGENTS rule 5.
   - Add tests covering simultaneous expansion of an original and its mirror.

10. Implement delete and promote semantics.
   - Extend deletion commands so removing the original promotes another mirror atomically, including ancestor-deletion cascades (section 4.2.2.4).
   - When deleting a mirror instance, prune only its child edges while preserving shared node data; ensure child deletions sync across all mirrors.
   - Write integration tests covering promotion, cascading deletes, and undo paths.

11. Build the mirror tracker indicator.
   - Add the right-border indicator that shows the mirror count, aligning markers with the first line of text without breaking row virtualization.
   - Implement the popup listing original and mirror paths, with breadcrumbs, highlight for the original (orange), and focus handling for keyboard and mouse interactions.
   - Ensure selecting an entry focuses the corresponding node via existing focus commands, respecting undo history boundaries.

12. Finalize telemetry, docs, and validation.
   - Update developer-facing docs (e.g., `docs/architecture`) if new interfaces or adapters are introduced, referencing them from AGENTS rule 18 when applicable.
   - Add concise inline comments where logic is non-obvious (e.g., promotion algorithm) and ensure logging or error messaging follows existing patterns.
   - Run `npm run lint`, `npm run typecheck`, and `npm test`, resolving any regressions before shipping.

## Step 1 - Mirror Scaffolding Audit

- **Data model:** `packages/client-core/src/doc/edges.ts` persists `mirrorOfNodeId` on every edge record inside `withTransaction`, while `packages/client-core/src/types.ts` exposes the field through `EdgeSnapshot` and `AddEdgeOptions`. Snapshots already carry the value for UI layers.
- **Invariants:** `addEdge` enforces cycle avoidance via `assertNoCycle`; comments now clarify that mirrors are pure edge metadata wrapping an existing `childNodeId`, ensuring node content stays shared.
- **Hydration flow:** `createOutlineSnapshot` and downstream selectors (`selectors.ts`, `useOutlineRows`) treat mirrors as regular edges. No mirror-specific rendering exists yet, but virtualization relies solely on `EdgeId`, so additional affordances can remain edge-scoped without structural changes.
- **Gaps to address later:** no command or drag-handler emits `mirrorOfNodeId`, existing dialogs ignore mirrors, and deletion or promotion flows do not yet differentiate originals vs mirrors. Subsequent steps must supply these behaviours.

## Step 2 - Shared Inline Trigger Plumbing

- **Reusable plugin:** `packages/editor-prosemirror/src/inlineTriggerPlugin.ts` now encapsulates trigger detection for any inline opener. `wikiLinkPlugin.ts` wraps it with `[[`, and mirror work can register its own plugin via the same helper.
- **Web hook:** `apps/web/src/outline/hooks/useInlineTriggerDialog.ts` centralises dialog state, keyboard handling, and result list selection. `ActiveNodeEditor` consumes it for wiki links, and the mirror dialog should wire into the same hook.
- **Refactored editor wiring:** `ActiveNodeEditor` now forwards `useInlineTriggerDialog`'s `pluginOptions` into `createCollaborativeEditor`, so future dialogs only need to supply platform-specific rendering.
- **Regression coverage:** `packages/editor-prosemirror/src/inlineTriggerPlugin.test.ts` exercises the generic plugin, ensuring wiki-link behaviour stays intact post-refactor.

## Step 3 - Mirror Dialog UI Shell

- **Shared UI foundation:** `apps/web/src/outline/components/InlineTriggerDialog.tsx` renders the common results list (styling, focus retention, scroll handling) and exposes a breadcrumb formatter for both dialogs.
- **Wiki dialog refactor:** `apps/web/src/outline/components/WikiLinkDialog.tsx` now delegates to the shared component to maintain parity and cut duplication.
- **Mirror dialog scaffolding:** `apps/web/src/outline/components/MirrorDialog.tsx` wraps the shared list with mirror-specific copy while accepting candidates shaped as `{ nodeId, text, breadcrumb }`.
- **Hook integration point:** `apps/web/src/outline/hooks/useMirrorDialog.ts` composes `useInlineTriggerDialog`, so Step 4 can feed plugin options and search results directly into the mirror dialog without rebuilding keyboard logic.
## Step 4 - Mirror Trigger Integration

- **Editor plumbing:** `packages/editor-prosemirror/src/mirrorPlugin.ts` adds the `((` trigger via the shared inline trigger infrastructure. `createCollaborativeEditor` now accepts `mirrorOptions` and surfaces `getMirrorTrigger`, `consumeMirrorTrigger`, and `cancelMirrorTrigger` to downstream code.
- **Web adapter:** `apps/web/src/outline/ActiveNodeEditor.tsx` wires `useMirrorDialog` into the editor lifecycle, feeds plugin callbacks into `createCollaborativeEditor`, and renders `MirrorDialog` alongside the wiki dialog.
- **Candidate search:** `packages/client-core/src/wiki/mirrorSearch.ts` currently wraps wiki search results (filtering arrives in Step 6) so both dialogs receive consistent breadcrumb metadata.
- **Tests:** Additional assertions in `packages/editor-prosemirror/src/index.test.ts` cover mirror trigger activation, commit, and cancellation to guard future regressions.

## Step 5 - Mirror Edge Creation Logic

- **Shared command:** `packages/client-core/src/mirror/createMirrorEdge.ts` introduces `createMirrorEdge`, deciding between converting the active edge and inserting a sibling mirror while keeping mutations inside a single transaction. Conversion cleans up orphan nodes and stamps `mirrorOfNodeId` on every mirror edge.
- **Test coverage:** `packages/client-core/src/mirror/createMirrorEdge.test.ts` exercises conversion, sibling insertion, and the missing-target guard so shared logic stays regression-safe.
- **Editor integration:** `apps/web/src/outline/ActiveNodeEditor.tsx` now calls `createMirrorEdge`, clears multi-select state, focuses the resulting edge, and restores the typed `((` sequence if the command declines a candidate.
- **Exports:** `packages/client-core/src/index.ts` re-exports the mirror command so other packages (drag/drop, mobile) can reuse it without duplicated wiring.
- **Notes for Step 6 implementers:** Candidate filtering should prefer to catch mirror-of-mirror or cycle cases before dispatching the command. If the filter misses something `createMirrorEdge` still returns `null`, and the editor will reinsert `((`—keep that recovery path in mind when adding new guards or telemetry.

## Step 6 - Candidate Filtering & Cycle Guards

- **Snapshot filtering:** `packages/client-core/src/wiki/mirrorSearch.ts` now resolves canonical breadcrumbs via original edges, removes mirror-only placements, and rejects candidates anywhere on the ancestor chain of the active edge’s parent to prevent cycles.
- **Dialog wiring:** `apps/web/src/outline/ActiveNodeEditor.tsx` passes the primary edge into `searchMirrorCandidates`, giving the provider enough context to evaluate ancestry.
- **Tests:** `packages/client-core/src/wiki/__tests__/mirrorSearch.test.ts` covers mirror-only candidates, parent/ancestor cycles, and ensures descendants still surface.
- **Notes for Step 7 implementers:** Alt-drag should reuse `createMirrorEdge` plus the new ancestry helpers to validate drop targets without re-scanning the Yjs tree on every pointer move.

## Step 7 - Alt+Drag Mirror Creation

- **Shared command reuse:** `createMirrorEdge` accepts explicit parent/index targets so drag-and-drop can insert mirrors without duplicating edge creation logic. Multi-edge drops wrap the loop in a single transaction to preserve undo granularity.
- **Hook behaviour:** `packages/client-react/src/outline/useOutlineDragAndDrop.ts` detects the Alt modifier during drag finalisation. When active, it calls the mirror command instead of `moveEdge`, ensuring originals stay put while mirrors appear at the drop location.
- **Selection parity:** Tests in `packages/client-react/src/outline/__tests__/useOutlineDragAndDrop.test.tsx` verify both single-edge and multi-edge Alt drags, asserting mirror metadata and ordering.
- **Notes for Step 8 implementers:** Bullet affordances should distinguish originals vs mirrors using the `mirrorOfNodeId` flag, and remember that Alt-drag now leaves the original edge in place—virtual row rendering must account for the extra mirrors when calculating halos.

## Step 8 - Mirror Bullet Affordances

- **Shared row metadata:** `packages/client-react/src/outline/useOutlineRows.ts` now surfaces each row’s `mirrorOfNodeId` and per-node mirror counts so UI layers can render affordances without re-walking the snapshot.
- **Halo rendering:** `packages/client-react/src/outline/components/OutlineRowView.tsx` applies 1px orange (original) and blue (mirror) rings via `box-shadow`, preserving the collapsed halo footprint and keeping virtualization metrics untouched.
- **Coverage:** Tests in `packages/client-react/src/outline/components/__tests__/OutlineRowView.test.tsx` assert that both original and mirror rows receive the correct halo treatment.
- **Notes for Step 9 implementers:** When splitting child edge identity per mirror, keep the new mirror metadata consistent so these halos remain accurate, and ensure expanded mirrors don’t lose their ring as children are virtualised.

## Step 9 - Maintain Child Edge Identity Per Mirror

### Step 9a - Snapshot & Data Model Foundations
- Outline snapshots now emit `childEdgeIdsByParentEdge` and `canonicalEdgeIdsByEdgeId`, cloning child edges only for mirror parents so every outline edge instance stays edge-scoped while still sharing node content.
- `buildPaneRows` consumes the projection map to traverse per-parent child lists, keeping ancestor metadata intact while presenting unique `edge.id` values for mirror branches.
- Added coverage in `doc/snapshots.test.ts` and `selectors.test.ts` to exercise mirror creation, reconciliation, and simultaneous original/mirror expansion, ensuring projected IDs remain stable.

### Step 9b - Selection & Collapse State Integrity
- Update selection, collapse, and presence flows to operate strictly on edge IDs so original and mirror child edges can be expanded/selected independently.
- Verify multi-select, cursor, and collapse toggles behave correctly when original and mirror hierarchies are expanded simultaneously.
- Ship tests covering selection transitions between original/mirror child edges and ensuring collapse state stays edge-scoped.
- Notes from 9a: session state (selection/collapse) still stores the projected edge IDs, while command layers convert to canonical via the new helpers in `useOutlineSelection`/`useOutlineDragAndDrop`. Keep those helpers authoritative so per-instance UI state remains stable without double-mapping.

### Step 9c - Virtualization & Rendering Consistency
- Adapt row derivation and virtualization layers so mirror children render with stable keys, depth, and ancestry metadata.
- Ensure drop indicators, guideline math, and drag-and-drop plans treat mirror children as distinct rows.
- Add integration coverage demonstrating simultaneous expansions of an original and its mirror render accurately with unique child edge keys.
