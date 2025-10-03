**Rule 15 – Explain intent**
- `apps/web/src/outline/OutlineView.tsx:1` lacks a module-level comment describing responsibilities, inputs, and invariants for the 2,900+ line component. This violates the requirement to document intent for future maintainers.
- `apps/web/src/outline/OutlineProvider.tsx:1` does not provide a module overview despite orchestrating sync/session orchestration, making it hard to reason about the provider’s contracts.
- `apps/web/src/outline/ActiveNodeEditor.tsx:1` omits the required top-level comment while handling collaborative editor composition.
- `apps/web/src/outline/platformAdapters.ts:1`, `apps/web/src/outline/syncPersistence.ts:1`, `apps/web/src/outline/websocketProvider.ts:1`, `apps/web/src/outline/flattenSnapshot.ts:1`, and `apps/web/src/outline/OutlineView.test.tsx:1` all miss module intent comments.

**Rules 8 & 17 – SOLID and composability**
- `apps/web/src/outline/OutlineView.tsx:268`-`apps/web/src/outline/OutlineView.tsx:506` mixes view rendering with session store mutation logic, pointer/keyboard event handling, and cursor management inside a single component. The monolithic component handles presentation, persistence, and complex side-effects simultaneously, reducing composability and violating the separation of responsibilities encouraged by SOLID.
