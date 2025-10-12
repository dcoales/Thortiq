# Thortiq Multi-User & Identity Specification

## 1. Purpose & Scope
- **Goal:** Introduce authenticated, multi-user usage across all platforms while keeping client data, preferences, and sync state fully isolated per user.
- **Coverage:** Login UX, session lifecycle, account recovery, multi-factor authentication (MFA), secure storage of profile/preferences (e.g. colour palettes), and required backend and client architecture changes.
- **Constraints:** Must respect existing Core Stability Rules (withTransaction boundaries, single ProseMirror instance, shared-first architecture) and maintain offline-first behaviour.

## 2. User Journeys
- **Primary sign-in:** User launches any Thortiq client (web, desktop, mobile) and sees a branded login screen, signs in, and is routed to their synced outline.
- **Return visit:** User reopens the app and is transparently reauthenticated if policy allows, otherwise prompted according to risk-based session expiry rules.
- **Forgot password:** User triggers account recovery from the login screen, receives guidance and a secure reset path without leaking account existence.
- **MFA challenge:** User with MFA enabled supplies a second factor after password verification.
- **Preference sync:** User’s theme/colour palette and other settings follow them across devices while staying invisible to other accounts.

## 3. Authentication & Login Experience
- **Professional cross-platform UI**
  - Fullscreen modal or screen with brand gradient background, central card containing form, responsive layout.
  - Display `images/ThortiqLogo.webp` above the form (alt text “Thortiq logo”), maintain 4.5:1 colour contrast, large touch targets (min 48x48 dp).
  - Inputs: email/username, password, optional “Remember this device” checkbox, MFA prompt surfaces inline when needed.
  - Provide contextual help links (privacy, Terms).
  - Implement as a shared React component in `packages/ui-auth` with adapters in `apps/web`, `apps/desktop`, `apps/mobile`.
- **Credential submission flow**
  - POST to new `/auth/login` endpoint (JSON: `{ identifier, password, deviceId, remember }`).
  - Server validates credentials, issues short-lived access token + long-lived refresh token (rotation+binding to device).
  - Use TLS everywhere; pin certificates on native apps.
- **Offline-first consideration**
  - Cache last successful user profile locally encrypted per platform key store (Web Crypto, iOS Keychain, Android Keystore, OS credential locker).
  - When offline, allow the most recent authenticated user to access cached data if refresh token still valid AND device marked trusted. Otherwise show read-only cached view with banner “Offline – sign-in required”.

## 4. Session Persistence (“Remember Me”)
- **Best-practice rules**
  - Default token lifetimes: access token 15 minutes, refresh token 30 days for trusted devices, 12 hours for untrusted.
  - Force reauthentication on device change, password change, account recovery, or elevated-risk events (per OWASP ASVS 2.1, NIST SP 800-63B).
  - Bind refresh tokens to deviceId + user agent fingerprint hash; invalidate on mismatch.
  - Store refresh tokens in secure, httpOnly cookies on web (SameSite=Lax, `Secure`), in OS-protected storage on native.
  - Support “Log out of all devices” endpoint to revoke all refresh tokens.
  - Implement background refresh with exponential backoff; never store plaintext passwords.

## 5. Account Recovery (“Forgot Password”)
- **Login screen entry point:** Text link “Forgot password?” beneath the password field, emphasised but secondary.
- **Flow requirements**
  - Collect identifier (email) only; display neutral confirmation text (“If an account exists you’ll receive…”) to avoid enumeration.
  - Send signed, single-use reset link (expires in 15 minutes) via transactional email provider (e.g. SES, Postmark). Reset tokens stored hashed with `userId`, `issuedAt`, `used` flag.
  - Include device & location metadata in email for verification, plus support contact.
  - Rate-limit requests per IP and account (e.g. 5/hour), log attempts for monitoring.
  - Reset form enforces strong passwords (OWASP password policy: min length 12, block breached passwords via k-Anonymity API, allow long passphrases).
  - After successful reset, invalidate all sessions, require new login + MFA rebind.
  - Provide alternative flows for SSO (future) and support-assisted resets with manual admin tooling.

## 6. Multi-Factor Authentication (MFA)
- **Supported factors (phased rollout)**
  1. Time-based One Time Password (TOTP) apps (RFC 6238) as baseline.
  2. WebAuthn / FIDO2 security keys or platform authenticators for passwordless future.
  3. Backup recovery codes (10 single-use codes generated/stored hashed; show once, allow regenerate).
- **UX**
  - Offer MFA enrolment post-login or in account settings; display risk-based prompts.
  - Remember MFA for trusted devices for 30 days (stored server-side, device-bound).
  - Provide fallback path using backup codes; enforce MFA for admin/staff accounts.
- **Server**
  - Store MFA secrets encrypted at rest with per-user key derived from master key (KMS/HSM).
  - Integrate MFA checks into unified `/auth/complete` step, ensuring Yjs UndoManager unaffected by auth boundary changes.

## 7. Data & Sync Isolation
- **Per-user namespaces**
  - Each Yjs document (outline, preferences, tags) namespaced by `tenantId/userId`.
  - Sync server enforces ACLs: clients can only subscribe to docs they own or have been explicitly shared.
  - Maintain cross-user share support by modelling edge permissions separate from node data (aligns with “mirrors are edges” rule).
- **Client storage**
  - Persist user data in per-user directories/databases (e.g. IndexedDB database name `thortiq::<userId>`, mobile SQLite keyed by user).
  - Clear caches on logout; avoid leaking data between OS accounts.
  - Preferences (colour palette, keyboard settings) stored in shared `packages/client-core` model with `withTransaction()` wrappers.
- **Server schema updates**
  - Tables/collections: `users`, `credentials`, `sessions`, `mfa_methods`, `user_preferences`, `devices`, `password_resets`, `audit_logs`.
  - Passwords hashed with Argon2id (memory-hard), pepper via environment secret.
  - Store minimal PII; track consent timestamps for compliance (GDPR/UK DPA).

## 8. Platform Architecture Impacts
- **Shared-first implementation**
  - Authentication logic and models live in `packages/client-core/auth`.
  - UI components in `packages/ui-auth`; adapters handle platform navigation, biometrics (FaceID/Windows Hello).
  - Server additions in `services/sync-server` (Express/Fastify) with new auth module decoupled from Yjs message routing.
- **Service integrations**
  - Email provider for resets, MFA recovery notifications.
  - Optional push notification adapter for login alerts.
  - Monitoring/alerting pipeline (e.g. OpenTelemetry traces for auth endpoints).
- **Testing**
  - Unit tests for token lifecycle, cryptographic helpers.
  - Integration tests simulating login + sync handshake (ensure UndoManager unaffected).
  - UI automation for login, remember-me, forgotten password flows (web + mobile).
  - Security tests: brute-force protection, session fixation, CSRF for web cookie paths.

## 9. Security & Compliance Checklist
- Enforce TLS 1.2+; HSTS on web domains.
- Rate-limit and CAPTCHA (adaptive) on login/reset endpoints after repeated failures.
- Implement anomaly detection (new device, ASN change) to trigger step-up auth.
- Maintain audit log (immutable append-only) of sign-ins, MFA enrolments, recovery events.
- Provide user-facing sessions page to revoke devices.
- Regularly rotate signing keys for JWTs; use asymmetric keys stored in KMS.
- Conduct annual penetration tests and dependency vulnerability scans.

## 10. Open Questions & Follow-ups
- Decide on supported SSO providers (OAuth2/SCIM) for future enterprise needs.
- Evaluate biometric unlock reuse (platform-specific) while respecting “remember me” policy.
- Determine branding assets and motion guidelines for the login experience.
- Confirm data residency/legal requirements before storing PII in specific regions.
- Specify rollout plan (beta users, migration of single-user data to per-account schema).

