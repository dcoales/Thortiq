# Testing Conventions

Thortiq leans on Vitest + Testing Library for fast feedback while reserving integration coverage for shared packages.
These guidelines keep the suite reliable across platforms and future automation.

## Layers
- **Packages (`packages/*`)** – Unit tests cover pure helpers (`client-core`, `sync-core`, `outline-commands`). When Yjs
  is involved, operate through exported helpers so every mutation remains inside `doc.transact`.
- **Apps (`apps/web`)** – Interaction tests use Testing Library to mimic keyboard flows (`OutlineView.test.tsx`). Avoid
  writing to DOM nodes directly; dispatch real events (keydown, click) so focus and selection logic stay realistic.
- **Preview QA** – The Vite preview (`pnpm preview`) spins up in-memory sync contexts with synthetic outline data. Use it
  to smoke-test visual changes, collapsed branches, and virtualisation tweaks without relying on the live sync server.

## Best Practices
- Reset globals that tests patch (`navigator.onLine`, `WebSocket`) and wrap them in `try/finally` blocks. The
  reconnection tests in `SyncManager.test.ts` are a template.
- Prefer deterministic factories (`createEphemeralPersistenceFactory`, `createEphemeralProviderFactory`) when the real
  provider would hit the network.
- Never introduce `any`. When type escapes are unavoidable, add a TODO comment with owner/date explaining the follow-up.
- Keep assertions focused on behaviour (document structure, undo history) rather than implementation details.

## Required Commands
- Lint, typecheck, and tests (`pnpm run lint && pnpm run typecheck && pnpm test`) gate every change locally and in CI.
- Build (`pnpm build`) before shipping changes that may influence bundling or preview output.

Following these conventions ensures the editor remains reliable as we scale collaboration features and platform support.
