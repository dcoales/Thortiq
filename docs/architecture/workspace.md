# Thortiq Workspace Setup

This monorepo uses `pnpm` workspaces to keep shared packages and platform adapters aligned.

## Prerequisites
- Node.js 20.x (LTS)
- Corepack enabled (`corepack enable` once per machine). This repo pins `pnpm@8.15.4` via the root `package.json`.

## Install
```bash
pnpm install
```

## Useful scripts
- `pnpm lint` – run ESLint across the workspace using the shared flat config.
- `pnpm typecheck` – execute a repo-wide TypeScript pass with `tsconfig.json`.
- `pnpm test` – run Vitest in happy-dom with coverage output under `coverage/`.
- `pnpm dev` – start the Vite dev server for `apps/web`.
- `pnpm build` – build the web app via Vite (shared dependencies live in `node_modules/`).

Each package also exposes local scripts (e.g., `pnpm --filter @thortiq/client-core lint`) if you want to scope checks.

## Layout
- `packages/client-core` – shared domain helpers (Yjs schema plumbing arrives in Step 2).
- `packages/editor-prosemirror` – editor integration surface for ProseMirror hooks.
- `apps/web` – React adapter that will host the outline UI.

To keep zips lean (AGENTS.md §20) the workspace uses a hoisted node modules folder at the repo root; source folders stay free of installed dependencies.

## Session helpers
- `packages/sync-core` exposes the persisted session store used to track pane layout and selections.
  See [Session State Specification](../session_state.md) for schema and migration guidance.
- Platform adapters (e.g. `apps/web`) should wrap the store with hooks/selectors instead of storing
  pane state in component trees to keep behaviour consistent across surfaces.

