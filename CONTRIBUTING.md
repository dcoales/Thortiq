# Contributing to Thortiq

Thanks for helping us build the collaborative outliner. This repo is optimised for LLM + human pairing, so a few
structure rules keep the system stable.

## Tooling & Environment
- We use **pnpm** (see `package.json` for the pinned version). Enable Corepack or install pnpm manually before
  running any commands.
- Install workspace dependencies with `pnpm install --frozen-lockfile`.
- Day-to-day development happens inside the web app (`pnpm dev`).
- For QA drills, run the multi-scenario preview with `pnpm preview` (renders the new outline showcase page backed by
  in-memory sync adapters).

## Quality Gates
- Every change must pass the triad of checks: `pnpm run lint`, `pnpm run typecheck`, and `pnpm test`.
- When introducing UI or build-related changes, smoke-test the bundle via `pnpm build`.
- CI (see `.github/workflows/ci.yml`) mirrors these steps across the active Node LTS releases—keep the scripts green
  locally before raising a PR.

## Coding Guidelines
- **Transactions only.** All structural/text mutations must flow through the helpers in `@thortiq/client-core` or be
  wrapped in `withTransaction` (see `AGENTS.md` rules 3 & 4).
- **SOLID & composable.** Shared code belongs in `packages/*`; platform shells act as thin adapters. Keep view logic,
  data ops, and side-effects separated. Avoid `any`; use TODOs with owner/date if a temporary escape hatch is
  unavoidable.
- **Virtualisation awareness.** The outline relies on TanStack Virtual. Batch expensive recomputations, debounce
  derived indexes, and never re-render the whole tree on every keystroke.
- Mirrors are edges: keep edge-local state (collapsed, mirror metadata) on the edge record, not on nodes.
- Update architecture docs whenever you shift structure, adapters, or protocols (`docs/architecture/*`). The new
  testing/virtualisation notes in Step 8 are good templates.

## Testing Expectations
- Prefer Vitest + Testing Library for unit/integration coverage. Mimic real user flows—no direct DOM surgery in tests
  while typing.
- When modifying shared sync or persistence logic, add coverage under the relevant package (`packages/client-core`,
  `packages/sync-core`, etc.).
- Use the preview page or ephemeral providers for manual verification rather than relying on live sync services.

## Documentation
- Keep `docs/architecture` aligned with the implementation. If you make structural changes, add or update an
  architecture note and link it in your PR/task summary.
- Summaries should explain *intent* at the module level so future agents can orient quickly.

Following these guardrails keeps the editor stable for multi-agent collaboration. Thanks for contributing!
