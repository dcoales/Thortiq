### Tasks Pane (Spec §9) — Step-by-step implementation plan for an LLM

Scope: implement a first-class Tasks Pane that lists and edits tasks across the entire outline, grouped and reschedulable by due date, with search and a persistent “Show Completed” toggle. Follow AGENTS.md rules throughout (transactions, single editor instance, virtualization, unified history, etc.). No feature flags.

---

### 1) Data model and contracts

- **Add pane kind**
  - Extend `packages/sync-core/src/sessionStore/state.ts` `SessionPaneState` with `paneKind: "outline" | "tasks"` (default "outline"). Bump session version and write a migration that sets existing panes to "outline".
  - Update creators like `defaultSessionState()` and any pane openers in `packages/client-core/src/panes/paneCommands.ts` to accept an optional `paneKind` and set it.

- **Task metadata + due date**
  - Reuse `NodeMetadata.todo` in `packages/client-core/src/types.ts` (`done`, `dueDate?: string`). No schema change required.
  - Implement `getTaskDueDate(outline, nodeId): Date | null` in `packages/client-core/src/doc`:
    - If `metadata.todo?.dueDate` present, parse ISO to `Date`.
    - Else scan inline content for the first date pill and derive an ISO date. Prefer reusing helpers from `packages/client-core/src/doc/journal.ts` (e.g., date mark readers) or introduce a small utility that finds the first inline `date` mark.
  - Implement `setTaskDueDate(outline, nodeId, date: Date, origin?)`:
    - In a single `withTransaction`, either update the first inline date mark via `updateDateMark(...)` or insert a date pill (use `buildDatePillHtml` as needed) at the end of the node text if none exists.
    - Update `metadata.todo.dueDate` to the ISO string. Ensure `updatedAt` is set. This preserves editor/date pill parity and search consistency. (Rules 3, 6, 24, 29)

- **Preference for Show Completed**
  - Persist `tasksPane.showCompleted: boolean` in client preferences (`packages/client-core/src/preferences`). Default false. Store locally per device (offline-first) and load on app start. (Rules 13, 28)

---

### 2) Pane opening and side panel entry

- **Side panel**
  - In the web adapter’s side panel, add a “Tasks” item with an icon placed below “Journal”. When clicked (collapsed or expanded), open a pane with `paneKind: "tasks"` as the last pane on the right.

- **Openers**
  - Add `openTasksPaneRightOf(state, referencePaneId)` in `packages/client-core/src/panes/paneCommands.ts` as a thin wrapper over `openPaneRightOf` that sets `paneKind: "tasks"`.
  - Ensure newly opened tasks pane becomes active. (Spec 9.1)

---

### 3) Rendering: map pane kind to view

- **Pane host**
  - In the pane renderer (React adapter, e.g., `packages/client-react/src/outline/PaneManager.tsx` consumer), route panes by kind:
    - `outline` → existing outline view component
    - `tasks` → new `TasksPaneView`

- **Single editor instance**
  - Keep the shared ProseMirror instance policy: only the active row across all panes mounts the editor (AGENTS rule 20). Ensure `TasksPaneView` integrates with the shared active editor just like outline rows. (Rules 20–25)

---

### 4) TasksPaneView UI and header

- Header mirrors outline header but without breadcrumb (Spec 9.6):
  - Search icon toggles a search input that filters tasks (and their descendants) in this pane only. Reuse the existing search runtime state in `SessionPaneSearchState` and evaluation pipeline.
  - “Show Completed” toggle bound to `tasksPane.showCompleted` preference; default off; persists across sessions.

- Body sections (Spec 9.2): Overdue, Today, Next seven days, Later, Undated
  - Compute due date via `getTaskDueDate`. Classify into sections:
    - Overdue: due date < today (by day)
    - Today: due date = today
    - Next seven days: days [tomorrow .. +7]
    - Later: any other dated tasks
    - Undated: no due date
  - Within all sections except Today and Undated, group by day. Day header format: `dddd, MMMM DD, YYYY`.
  - Headers are collapsible. Store collapsed state in `PaneRuntimeState` keyed by synthetic section/day ids (runtime-only; do not persist in session or Yjs). (Rules 7, 23)

- Rows
  - Render each task node similarly to outline rows, including bullet, checkbox (done state), text, mirror-count indicator if applicable. Respect virtualization and row measurement stability. (Rules 7, 23)

---

### 5) Data sourcing and grouping pipeline

- **Selector** `selectAllTasks(snapshot, options)` in `packages/client-core/src/selectors.ts`:
  - From the current `OutlineSnapshot`, iterate canonical edges; include nodes where `metadata.todo` exists.
  - If pane search is active, evaluate using existing search engine; filter tasks (and include their descendants when editing in context) accordingly for this pane only.
  - If `showCompleted` is false, exclude `todo.done === true`.
  - For each task, compute `dueDate: Date | null` with `getTaskDueDate`.
  - Group into the five sections, then sub-group by day where applicable. Produce a stable, virtualizable flat list with synthetic header rows and item rows including keys and depths suitable for TanStack Virtual. (Rules 7, 30, 33)

- **Virtualization**
  - Use the same virtual list infra as outline panes. Ensure row height changes (expand/collapse; editing) trigger appropriate re-measure. Avoid heavy recomputation on every update; memoize by `edgeId`, `dueDate`, `done`, and search state. (Rules 7, 23, 30)

---

### 6) Editing tasks in place (Spec 9.3)

- Mount the shared active editor on the focused task row.
- Enter key behavior override for Tasks Pane:
  - If caret at end of line in a task: create a new node as the first child of the task and expand the task. Otherwise do nothing (no sibling split/insert semantics in this pane). Implement this as a Tasks Pane command that delegates to existing `createNode` utilities inside a `withTransaction`. (Rules 3, 6, 20, 24, 29)
- Allow expanding/collapsing task nodes to view and edit children, reusing outline expand/collapse logic but storing the expanded state as edge-local (mirrors are edges) and honoring virtualization. (Rules 5, 23)

---

### 7) Drag & drop rescheduling (Spec 9.4)

- DnD targets:
  - Section headers: Today, Next seven days, Later
  - Day headers (including all 7 explicit day headers under Next seven days even if empty)

- Drop outcomes:
  - Drop on a day header → set due date to that day.
  - Drop on Today → set due date to today.
  - Drop on Next seven days → set due date to tomorrow.
  - Drop on Later → set due date to today + 8 days.

- Implementation notes:
  - Support dragging one or more selected tasks while preserving order.
  - On drop, in a single `withTransaction`, call `setTaskDueDate` for each task. If a task has an inline date pill, update it via `updateDateMark`; else insert a date pill at the end and set metadata `todo.dueDate`. (Rules 3, 6, 24, 29)
  - Ensure Undo/Redo integrates with the unified history; remote changes must not enter local undo. (Rule 6)

---

### 8) Focus behavior interop (Spec 9.5)

- The Tasks Pane cannot be focused to a node the way an outline pane can. Implement click/modified-click on a task bullet as:
  - Click: open a new Outline pane immediately to the left of the Tasks Pane focused on the task.
  - Shift-click: if there is already a pane immediately to the left, reuse it by focusing the task; otherwise create a new one to the left. Implement helper `openPaneLeftOf(referencePaneId, options)` mirroring `openPaneRightOf`.

---

### 9) Search integration for Tasks Pane (Spec 9.6)

- Header search filters only this pane’s rows. Reuse `SessionPaneSearchState` and evaluation code; constrain results to tasks (and their descendants when needed for context). Clearing or navigating focus should restore the header to non-search state as with outline panes.

---

### 10) Persistence, performance, and UX compliance

- Transactions for all mutations (Rule 3). No DOM surgery during typing (Rule 4).
- Single editor instance policy (Rules 20–22). Virtualization kept stable (Rules 7, 23).
- Edge-local state for collapsed/expanded on edges (Rule 5). Group header collapsed state is runtime-only.
- Debounce non-critical recomputations (indexing, grouping) (Rule 30). Dispose observers and avoid leaks (Rule 32).
- Keyboard-first: ensure keyboard access to headers, toggle, DnD alternatives (Rule 34). Clear error handling (Rule 37).

---

### 11) Tests

- Unit tests (shared code, `packages/client-core`):
  - `getTaskDueDate` extraction from metadata and from the first inline date pill.
  - Grouping logic for all five sections and day subgroups; boundary conditions around midnight and timezone.
  - `setTaskDueDate` updating inline mark and metadata in a transaction.
  - Selector stability and memoization keys; Show Completed filtering.

- Integration tests (React adapter):
  - Open Tasks Pane from side panel; verify pane kind and header.
  - Edit a task inline; Enter-at-end inserts first child and expands.
  - Drag tasks onto headers and verify due date changes and re-grouping.
  - Bullet click opens/shift-click reuses left outline pane as specified.
  - Search in Tasks Pane filters results; navigation clears search as expected.
  - Virtualizer re-measures correctly on expand/collapse and edit.

- Editor-flow tests follow full interaction patterns (focus/blur, command dispatch, async commits) to catch cursor issues (AGENTS Testing Pattern; Rule 19).

---

### 12) Documentation and architecture notes

- Add a short architecture note under `docs/architecture/` describing `paneKind`, Tasks Pane rendering, grouping, and DnD rescheduling, and link it from PR notes. (Rule 18)

---

### 13) Deliverables checklist

- Pane kind + migration in `sync-core` and updated openers in `client-core`.
- `getTaskDueDate` and `setTaskDueDate` helpers using transactions.
- `tasksPane.showCompleted` preference persisted.
- `TasksPaneView` with header (search + toggle) and virtualized, collapsible section/day groups.
- DnD rescheduling to day/section headers, including multi-select.
- Focus interop that opens/reuses an outline pane to the left.
- Tests: unit + integration passing in CI. Lint/typecheck clean (`pnpm run lint && pnpm run typecheck && pnpm test`).

---

### 14) Step-by-step execution order (recommended)

1. Add `paneKind` to `SessionPaneState`, bump version, write migration; wire `openTasksPaneRightOf`.
2. Implement `getTaskDueDate` and `setTaskDueDate` with transactions; unit tests.
3. Add `tasksPane.showCompleted` preference with load/save.
4. Build `selectAllTasks` grouping selector; unit tests for grouping and boundaries.
5. Create `TasksPaneView` with header and virtualized body; hook into pane renderer by kind.
6. Implement Enter-at-end behavior to create first child; expand node.
7. Implement DnD rescheduling to headers; integration tests.
8. Implement focus interop (open/reuse pane to the left); tests.
9. Wire header search to constrain/filter tasks; tests.
10. Polish, a11y, performance passes; finalize docs; run lint/typecheck/tests.



