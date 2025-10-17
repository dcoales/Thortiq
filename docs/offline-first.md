## Offline-First Local Persistence Plan

1. **Adjust logout semantics**
   - Stop invoking `clearOutlineCaches` during a standard logout so IndexedDB snapshots persist.
   - Keep the existing cleanup helper for explicit “Forget device” flows and global logout (logout everywhere).
   - Track a lightweight `needsReauth` flag in session storage so the UI knows cached data exists but still requires credentials before syncing.

2. **Update authentication UI & store**
   - Extend the auth store to surface the `needsReauth` state when tokens are cleared but cached outlines remain.
   - Modify logout flows in the web shell (and future desktop/mobile shells) to set this flag instead of purging the cache.
   - Add explicit “Clear local data” / “Forget this device” actions that call `clearOutlineCaches`.

3. **Outline provider lifecycle changes**
   - Ensure `OutlineProvider` detects when cached outlines exist for the current user even before login and can hydrate the Y.Doc offline.
   - Gate network reconnection on successful re-authentication, but allow local editing immediately.
   - Avoid destroying the Yjs doc when switching to the login screen unless the user chose a destructive logout.

4. **Sync token usage for offline resumes**
   - Persist the `syncToken` (already stored) separately from auth tokens so it’s available after login, but prevent using it until access tokens are refreshed.
   - Update reconnection logic to delay WebSocket attempts until the auth store confirms the user has reauthenticated.

5. **Security and UX safeguards**
   - Provide visible indicators when the app is in “offline cache only” mode and offer quick actions to clear cached data.
   - Document the difference between logout (retains local data) and “Forget device” (clears everything).

6. **Testing & documentation**
   - Add unit/integration coverage for logout/relogin while offline, ensuring cached outlines persist and sync once back online.
   - Update `docs/architecture/offline-persistence.md` to describe the new flows and reference this plan for future agents.
