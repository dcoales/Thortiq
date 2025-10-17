## Sync Authentication Improvements

To align with OWASP token-based WebSocket guidance and AGENTS.md constraints, we’ll implement the following steps:

1. **Auth server response updates** – Extend login and registration verification handlers to mint a per-user sync token using `SYNC_SHARED_SECRET`, include it (and future refresh responses) in the JSON payload, and cover it with unit tests.
2. **Client auth store persistence** – Add the `syncToken` to `AuthSessionSecrets`/`StoredAuthSession` so it survives reloads, rotates alongside refresh tokens, and clears on logout, updating relevant store tests.
3. **Web/outline adapters** – Wire the session token into `createWebsocketProviderFactory`, falling back to the env token only before authentication, and adjust adapter tests to confirm the new path.
4. **Validation passes** – Run `npm run lint`, `npm run typecheck`, and `npm test` to keep the repo compliant with Core Stability Rule #1.
