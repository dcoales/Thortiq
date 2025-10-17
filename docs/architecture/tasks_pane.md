### Tasks Pane Architecture

Intent: Provide a first-class Tasks Pane that lists and edits tasks across the outline, grouped by due dates, reschedulable via drag-and-drop, and integrated with existing search and the shared editor, while respecting AGENTS.md constraints.

### Session and runtime state

- Pane kind: `paneKind` added to `SessionPaneState` (version 7) to distinguish `"outline" | "tasks"`. Migration logic treats v5/v6 as upgradeable.
- Runtime cache: `PaneRuntimeState` extended with `tasksCollapsedSections` and `tasksCollapsedDays` to store collapsible UI state without persisting it or adding to undo history.

### Core grouping and due date helpers

- `getTaskDueDate(outline, nodeId)`: prefers `metadata.todo.dueDate`, else first inline date mark.
- `setTaskDueDate(outline, nodeId, date, origin?)`: updates the first inline date mark if present and syncs `metadata.todo.dueDate` in a single transaction.
- `buildTaskPaneRows(snapshot, options)`: groups tasks into Overdue, Today, NextSevenDays (always 7 day headers), Later, and Undated and emits a flat row model with section/day headers and task rows for virtualization.

### Web adapter: TasksPaneView

- Mapping: `apps/web` renders panes by kind; `TasksPaneView` is used when `paneKind === "tasks"`.
- Header: search toggle for pane-local filtering using `runPaneSearch`, plus a persisted “Show Completed” toggle (`tasksPane.showCompleted` user preference).
- Body: renders grouped rows with collapsible section/day headers. Collapsed state stored in runtime via `updatePaneRuntimeState`.
- Editor: mounts the shared `ActiveNodeEditor` for the selected task row (single editor instance policy). `paneMode="tasks"` alters Enter behavior.

### Keyboard and editor behavior

- Enter-at-end override in `ActiveNodeEditor` when `paneMode = "tasks"`: if caret at end, expands the task (if collapsed and has children) and inserts a first child; otherwise no-op. All mutations occur inside Yjs transactions.

### Drag and drop rescheduling

- Drag source: task rows encode a payload containing either the primary edgeId or a contiguous selection range of task edgeIds.
- Drop targets: day headers and section headers (Today, NextSevenDays, Later). Hover feedback is shown.
- On drop: parse edgeIds and call `setTaskDueDate` for each, choosing target date as:
  - Day header → that day
  - Today → today (UTC day)
  - NextSevenDays → tomorrow
  - Later → today + 8 days

### Performance and UX

- Debounced row projection to avoid remeasure thrash on rapid updates.
- Virtualization-friendly row model (flat list of headers + tasks) to integrate with existing virtualizer patterns.
- Accessible headers: focusable, Enter/Space toggle; search input and controls are keyboard-accessible.

### AGENTS.md constraints observed

- Single editor instance reused across panes (`sharedCollaborativeEditor`).
- All mutations wrapped in transactions (`withTransaction`), maintaining unified undo history.
- No DOM surgery while typing; editor wiring follows existing patterns.
- Edge-local concerns preserved; collapse/runtime state remains non-persistent and out of undo.



