This document constrains how changes are made so the system stays stable.  Before declaring that a task is finished check all coding changes against the following rules:

1. **Keep the repo buildable.** Before finishing a task: `npm run lint && npm run typecheck && npm test`.
2. **Add conscise comments**
3. **Never mutate text/structure outside Yjs transactions.**
4. **No DOM surgery while typing otherwise the cursor may get lost
5. **Mirrors are edges.** Same `nodeId` may appear in multiple parents. Store edge‑local state (e.g., `collapsed`) on the **edge**.
6. **Unified history.** A single `UndoManager` tracks  structural, formatting and text changes.  Remote changes must not enter local undo history.
7. **Virtualize rows** to maintain performance.  A tree may contain 100's of thousands of nodes. Avoid heavy computations on every update; debounce non‑critical indexing.
8. **SOLID** .  Try to apply the SOLID design principles e.g. do not mix view logic, data ops, and side‑effects in the same file.
9. **Composition over inheritance.** Favor small composable functions/components and hooks. Inheritance only when a true subtype relationship is clear and stable.
10. **DRY, but not WET.** Extract common utilities where appropriate and try to reuse as much code as sensible across web, desktop and mobile applications
11. **Stable IDs.** Use UUID/ULID generators; never rely on array index for identity in app state.
12. **TypeScript not Javascript.** No `any` unless separately justified with a TODO including owner/date.

