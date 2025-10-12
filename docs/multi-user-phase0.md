# Phase 0 Findings – Multi-User Rollout

## 1. Spec & Guardrail Review
- Confirmed the governing rules in `AGENTS.md:1` enforce transactions, single ProseMirror instance, virtualization, and lint/type/test gates; all subsequent work must thread through existing helpers (`withTransaction` patterns already live in `packages/client-core/src/doc/transactions.ts:45`).
- `docs/multi_user_spec.md:1` now reflects the greenfield assumption plus Google federation requirements; no legacy migration steps are needed, but namespace isolation and shared-first layering remain mandatory.
- Architecture layering guidance remains anchored in `docs/architecture/thortiq_layers.md` (read to drive placement of new auth modules in shared packages and thin platform adapters).

## 2. Existing Auth & Sync Assessment
- Sync server authentication is currently a shared-secret HMAC token with no user datastore (`apps/server/src/auth.ts:1`), and WebSocket upgrades only validate `<userId>:signature` pairs without persistence (`apps/server/src/index.ts:127`).
- Document manager instances are keyed by raw `docId` strings with no per-user namespacing or ACL enforcement (`apps/server/src/docManager.ts:20`); snapshots are saved via pluggable storage (in-memory/S3) but carry no ownership metadata.
- Client packages do not expose any authentication or session primitives yet (`packages/client-core/src/index.ts:1` re-exports only outline utilities), so Phase 1 will introduce new shared auth types without conflicting code.
- No secret management helpers exist today; the sync server consumes a single `sharedSecret` option supplied at runtime (`apps/server/src/index.ts:144`), signalling minimal coupling and straightforward replacement.

## 3. Testing Baseline & Target Coverage
- Current automated coverage relies on Vitest across packages (`package.json:16` scripts run lint/typecheck/test); new modules must extend existing suites with unit tests for token & schema helpers plus integration tests for namespace enforcement.
- Plan: add server-side unit tests for auth repositories (Vitest in `apps/server`), client unit tests for new auth models (`packages/client-core`), and future e2e smoke tests once login UI emerges (Playwright harness to be introduced in Phase 3).
- Continue running `npm run lint && npm run typecheck && npm test` before sign-off, acknowledging existing max-line warnings in outline files that are out-of-scope.

## 4. Secrets & Environment Strategy
- Use per-environment `.env` files loaded via lightweight config helper (to be added in Phase 1) that map onto environment variables; never commit live credentials.
- Production secrets (JWT signing keys, Google client credentials, Argon2 pepper) will be sourced from AWS Parameter Store or Secrets Manager and injected into the runtime environment; local development uses `.env.local` guarded by `.gitignore`.
- Key rotation will be supported by reading secrets on process start with documented reload steps; future work will introduce config validation to fail fast when required values are missing.
