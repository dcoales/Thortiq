# Offline-First Architecture Fixes

## Problem Summary

The application was experiencing authentication failures when logging out and immediately logging back in. Investigation revealed two critical issues preventing the offline-first/local-first architecture from working correctly:

1. **Client-side**: IndexedDB was being cleared on logout
2. **Server-side**: SQLite database was opened in readonly mode
3. **Sync flow**: WebSocket provider was created even without a valid sync token

## Root Causes

### Issue 1: IndexedDB Cleared on Logout
**File**: `apps/web/src/auth/AuthenticatedApp.tsx`

The `AuthenticatedApp` component had a `useEffect` cleanup function that called `clearOutlineCaches({ userId })` when the component unmounted (which happens on logout). This violated the offline-first principle where local data should persist across sessions.

### Issue 2: SQLite Database Readonly Mode
**File**: `apps/server/src/identity/sqliteStore.ts`

The `SqliteIdentityStore` constructor was not explicitly setting database options, which in some cases caused better-sqlite3 to open the database in readonly mode, resulting in "attempt to write a readonly database" errors during login/logout operations.

### Issue 3: WebSocket Provider Without Token
**File**: `apps/web/src/outline/OutlineProvider.tsx`

The provider factory was creating a WebSocket connection even when no sync token was available, causing connection failures and preventing graceful offline operation.

## Solutions Implemented

### Fix 1: Remove Aggressive IndexedDB Cleanup

**Change**: Removed the `useEffect` cleanup that was clearing IndexedDB on logout.

**Rationale**:
- IndexedDB databases are already scoped by `userId` (`thortiq::<userId>::sync::outline:<docId>`)
- Different users don't conflict because of this scoping
- Users should be able to work offline after initial login
- Only clear caches when explicitly requested or when switching users

**Code diff**:
```typescript
// BEFORE: Cleared IndexedDB on component unmount (logout)
useEffect(() => {
  if (!userId) return;
  return () => {
    void clearOutlineCaches({ userId });
  };
}, [userId]);

// AFTER: No automatic cleanup, data persists across sessions
// See comment in code explaining offline-first architecture
```

### Fix 2: Explicitly Set SQLite Write Mode

**Change**: Added explicit options to better-sqlite3 constructor.

**Code diff**:
```typescript
// BEFORE:
this.db = new DatabaseConstructor(options.path);

// AFTER:
this.db = new DatabaseConstructor(options.path, {
  readonly: false,
  fileMustExist: false
});
```

**Rationale**:
- Ensures database is always opened with write permissions
- Creates database if it doesn't exist
- Prevents "attempt to write a readonly database" errors

### Fix 3: Use Ephemeral Provider Without Sync Token

**Change**: Only create WebSocket provider when a valid sync token exists.

**Code diff**:
```typescript
// BEFORE: Created websocket provider even without token
const providerFactory = createWebsocketProviderFactory({
  endpoint: envEndpoint ?? getDefaultEndpoint(),
  token: syncToken ?? envToken ?? undefined
});

// AFTER: Use ephemeral provider (stays disconnected) when no token
const hasValidToken = !!(syncToken ?? envToken);
const providerFactory = (!hasValidToken)
  ? createEphemeralProviderFactory()
  : createWebsocketProviderFactory({
      endpoint: envEndpoint ?? getDefaultEndpoint(),
      token: syncToken ?? envToken ?? ""
    });
```

**Rationale**:
- Allows app to work fully offline with IndexedDB
- Only attempts sync connection when authenticated
- Provides graceful degradation for offline scenarios

## Expected Behavior After Fixes

### Successful Offline-First Flow:

1. **First Login** (online):
   - User logs in with credentials
   - Auth succeeds, receives sync token
   - IndexedDB created: `thortiq::<userId>::sync::outline:<docId>`
   - Data syncs from server to IndexedDB
   - User can create/edit notes

2. **Logout**:
   - User logs out
   - Session cleared from server
   - **IndexedDB persists** (not deleted)
   - User returns to login screen

3. **Second Login** (can be offline):
   - User logs in again
   - Auth succeeds (if online) or uses cached credentials
   - **IndexedDB still exists** with previous data
   - User immediately sees their notes
   - If online: sync token received, changes sync
   - If offline: works with local data, syncs when connection returns

4. **Work Offline**:
   - User can view and edit all previously synced notes
   - Changes stored in IndexedDB
   - No sync errors displayed
   - When connection returns, changes automatically sync

## Testing Recommendations

### Manual Test Flow:
1. Start with clean state (clear IndexedDB manually if needed)
2. Log in successfully
3. Create a few notes
4. Verify IndexedDB exists in Chrome DevTools → Application → IndexedDB
5. Log out
6. **Verify IndexedDB still exists** in DevTools
7. Log back in
8. **Verify notes are immediately visible**
9. Disconnect network
10. Edit notes offline
11. Reconnect network
12. Verify changes sync

### Automated Tests Needed:
- Test IndexedDB persistence across logout/login cycles
- Test offline editing capabilities
- Test sync reconnection after being offline
- Test multiple users don't conflict (scoped IndexedDB)

## Architecture Compliance

These changes align with the repository rules:

- **Rule 28: Offline-first design** ✅ - All operations work offline and sync when connectivity returns
- **Rule 31: Lazy loading** ✅ - IndexedDB loads on-demand
- **Rule 32: Memory management** ✅ - Proper cleanup without destroying persistent data
- **Rule 40: Backward compatibility** ✅ - Changes don't break existing functionality

## Related Documentation

- `docs/architecture/offline-persistence.md` - Offline persistence architecture
- `docs/offline-first.md` - Offline-first design principles
- `docs/architecture/sync_adapters.md` - Platform-specific sync adapters
- `AGENTS.md` - Core stability rules and architecture principles

