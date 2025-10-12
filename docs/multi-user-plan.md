# Multi-User Feature Implementation Plan

## Phase 0 – Discovery & Guardrails ✅
- **Summary:** Completed 2025-10-12 following findings logged in `docs/multi-user-phase0.md`.
- **Key outcomes:** Validated guardrails (`AGENTS.md`), documented current shared-secret auth flow (`apps/server/src/auth.ts`) and doc manager gaps, defined phase-by-phase test expectations, and selected `.env` + AWS secrets for credential handling.

## Phase 1 – Domain & Data Model Foundations ✅
- **Summary:** Completed 2025-10-12. Auth schema, shared types, and namespace helpers are now committed.
- **Schema design:** Introduced `apps/server/src/db/schema.ts` with the initial migration covering `users`, `credentials`, `oauth_providers`, `sessions`, `mfa_methods`, `devices`, `user_preferences`, `password_resets`, and `audit_logs`, plus seed helpers in `apps/server/src/db/seed.ts`.
- **Shared types:** Added reusable identity models under `packages/client-core/src/auth` and exported them via the package entry point.
- **Namespace strategy:** Added doc-id helpers (`packages/client-core/src/sync/docLocator.ts`) and guarded WebSocket upgrades through `apps/server/src/namespaces.ts` so only owner-scoped docs load.
- **Preferences storage:** Expanded the Yjs-backed user preference store with generic setting helpers (`packages/client-core/src/preferences/userSettings.ts`) that wrap mutations in `withTransaction()`.

## Phase 2 – Authentication Services (Server)
- **Password auth endpoints:** Implement `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all` with Argon2id hashing, token rotation, and device binding.
- **Session persistence:** Issue short-lived access + long-lived refresh tokens; store refresh metadata tied to device fingerprint; add revocation logic.
- **Forgot password flow:** Build `/auth/forgot` and `/auth/reset` endpoints with secure token issuance, rate limiting, neutrally worded responses, and audit logging.
- **Google OAuth integration:** Implement `/auth/google` pipeline validating ID tokens via Google JWKS, handling new vs existing users, and storing provider linkage.
- **MFA enforcement:** Add middleware stages for MFA challenges, backup codes, and WebAuthn registration (server side), ensuring transactions wrap any Yjs-related mutations.
- **Monitoring & security:** Instrument logging, anomaly detection hooks, CAPTCHA toggles, and ensure all endpoints follow TLS, HSTS, CSRF protection for cookie flows.

## Phase 3 – Client Auth Framework
- **Shared auth store:** Create composable hooks/services in `packages/client-core/auth` managing token lifecycle, refresh scheduling, and offline cache, honouring undo history isolation.
- **Secure storage adapters:** Implement encrypted credential storage per platform (Web Crypto, Keychain, Keystore, OS credential locker) behind adapter interfaces; add unit tests.
- **Session bootstrap:** Update app initialisation to gate outline loading on authenticated session and to mount awareness/UndoManager only after identity is confirmed.
- **Account recovery UI:** Build shared components for forgot password, reset, and error states; wire to new endpoints with optimistic UX plus retry/backoff.
- **Google sign-in UX:** Insert “Continue with Google” button following Google branding; integrate Google Identity Services (web) and native SDK wrappers, funnel tokens through shared auth service.
- **Remember device controls:** Add UI for trusted devices checkbox, session listing, and “Log out everywhere”; ensure device metadata sync respects virtualization performance.

## Phase 4 – MFA & Security Enhancements
- **MFA enrolment flows:** Implement setup screens for TOTP, WebAuthn, and backup codes; ensure secrets handled via secure channels and stored encrypted.
- **Step-up prompts:** Integrate MFA challenges into login flow, including Google-authenticated users when policy demands; maintain focus management and keyboard accessibility.
- **Security alerts:** Add optional push/email notifications for new device sign-ins or sensitive changes, respecting shared-first adapters.
- **Audit surfaces:** Provide user-visible session log page with revoke buttons; ensure revocation updates UndoManager/sync sessions safely within transactions.

## Phase 5 – Preferences & Data Isolation
- **Per-user caches:** Partition IndexedDB/SQLite/local caches using `thortiq::<userId>` schema; wipe on logout; prevent cross-account data leaks.
- **Preference syncing:** Wire colour palette and other settings to new CRDT structures; add tests verifying isolation and offline resilience.
- **Sharing adjustments:** Ensure existing node-sharing features respect new account boundaries and permission checks without breaking mirrors-as-edges invariant.

## Phase 6 – Self-Service Registration
- **Endpoint delivery:** Implement `/auth/register`, `/auth/register/verify`, and `/auth/register/resend` on the sync server, persisting data via `SqliteIdentityStore` and applying existing rate-limit/CAPTCHA guards.
- **Email verification flow:** Generate signed, single-use tokens (15-minute TTL) and deliver via transactional provider; log the verification URL to `coverage/dev-mailbox/` when `NODE_ENV=development`.
- **Client UX updates:** Extend the shared auth surface to toggle between sign-in and sign-up forms, reuse error/notice components, and guard against enumeration with neutral confirmation copy.
- **Credential policy enforcement:** Validate passwords against breach list helper, surface inline strength meter, and support Google/OAuth linkage for matching emails.
- **MFA + device onboarding:** Offer immediate MFA enrollment post-verification when required; propagate “Remember this device” data into the device service and trusted-device lifetimes.
- **Local testing support:** Document `pnpm run sync:server` usage with `AUTH_DATABASE_PATH` persistence, provide tsx script to create dev accounts, and add Vitest coverage for happy path, duplicate email, expired token, and resend throttle cases.

## Phase 7 – Quality Assurance & Rollout
- **Automated tests:** Expand Vitest suites for auth services, token helpers, MFA logic, and Google integration mocks; add UI automation scripts for login/recovery/MFA flows.
- **Manual verification:** Exercise multi-device scenarios, offline login with trusted devices, Google sign-in, and recovery edge cases; document findings.
- **Documentation updates:** Refresh `docs/multi_user_spec.md` if deviations occur, and add adapter notes under `docs/architecture` as needed.
- **Deployment considerations:** Define deployment order (apply schema migrations, deploy server, then clients) and monitoring dashboards; no legacy data migration required.
- **Final validation:** Run `npm run lint`, `npm run typecheck`, and `npm test`; ensure no AGENTS.md rules are violated and repository remains buildable before ship.
