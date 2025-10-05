This document constrains how changes are made so the system stays stable.  Before declaring that a task is finished check all coding changes against the following rules:

1. **Keep the repo buildable.** Before finishing a task: `npm run lint && npm run typecheck && npm test`.
2. **Add conscise comments**
3. **Never mutate text/structure outside Yjs transactions.**
4. **No DOM surgery while typing otherwise the cursor may get lost
5. **Mirrors are edges.** Same `nodeId` may appear in multiple parents. Store edge‑local state (e.g., `collapsed`) on the **edge**.
6. **Unified history.** A single `UndoManager` tracks  structural, formatting and text changes.  Remote changes must not enter local undo history.
7. **Virtualize rows** to maintain performance.  A tree may contain 100's of thousands of nodes. Avoid heavy computations on every update; debounce non‑critical indexing.
8. **SOLID** .  Try to apply the SOLID design principles e.g. do not mix view logic, data ops, and side‑effects in the same file. Consider the Layering Overview in docs/architecture/thortiq_layers.md when considering how to structure the code.
9. **Composition over inheritance.** Favor small composable functions/components and hooks. Inheritance only when a true subtype relationship is clear and stable.
10. **DRY, but not WET.** Extract common utilities where appropriate and try to reuse as much code as sensible across web, desktop and mobile applications
11. **Stable IDs.** Use UUID/ULID generators; never rely on array index for identity in app state.
12. **TypeScript not Javascript.** No `any` unless separately justified with a TODO including owner/date.
13. **Shared-first architecture.** Prioritize reusable domain logic in shared packages (e.g. `packages/client-core`) and keep `apps/<platform>` code as thin adapters; extract common code before duplicating.
14. **Platform adapters.** Wrap platform-specific APIs behind explicit interfaces so shared modules depend on stable contracts; document new adapters in `docs/architecture` and link the doc in your PR/task notes.
15. **Explain intent.** Add brief module-level comments describing responsibilities, key inputs/outputs, and invariants so future maintainers (human or LLM) can navigate without digging through history.
16. **Test shared code.** Ship unit tests for reusable utilities and update integration tests when shared APIs change; breaking shared contracts requires updating dependent platform tests plus a changelog note.
17. **Keep logic composable.** Prefer small, pure helpers and hooks; avoid mixing side-effects, view logic, and data operations in a single module to preserve SOLID and ease reuse.
18. **Document structural shifts.** When introducing significant architectural or protocol changes, include an architecture sketch (Markdown/diagram) under `docs/architecture` and reference it here for future agents.
19. **Full-stack editor tests.** When adding or updating rich text/editor tests, mimic real frontend interaction flows (focus/blur, command dispatch, async commits) rather than shortcutting with direct state mutation so regressions like cursor jumps surface in CI.
20. **Node modules separate**: Keep node modules separate from other code so that I can easily zip up a folder with the source code for either the client applications or the server application separately without including node modules in either zip file.
