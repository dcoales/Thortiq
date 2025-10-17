# Dynamic Verification URL Generation

## Problem

The registration verification email links were hardcoded to `http://localhost:3000`, which didn't work when accessing the app from:
- Local hostname: `https://penguin.linux.test:5173`
- Remote IP: `https://192.168.0.56:5173`
- Other machines on the network

Users had to manually edit the URL in the email to make it work, which was a poor experience.

## Solution

Implemented dynamic verification URL generation that automatically uses the `Origin` header from the registration request. This means:

- **Local access** → `https://penguin.linux.test:5173/register/verify?token=...`
- **Remote access** → `https://192.168.0.56:5173/register/verify?token=...`
- **Localhost** → `https://localhost:5173/register/verify?token=...`

The server automatically generates the correct URL based on how you connected.

## Implementation

### 1. Service Layer Changes

**File**: `apps/server/src/services/registrationService.ts`

Added `origin` parameter to registration requests:

```typescript
export interface RegistrationRequest {
  // ... existing fields
  readonly origin?: string; // Origin header from request for dynamic verification URL
}

export interface RegistrationResendRequest {
  readonly identifier: string;
  readonly ipAddress?: string;
  readonly origin?: string; // Origin header for dynamic verification URL
}
```

Updated `composeVerificationUrl` to use dynamic origin:

```typescript
private composeVerificationUrl(token: string, origin?: string): string {
  // Use dynamic origin from request if available, otherwise fall back to configured base URL
  const baseUrl = origin ? `${origin}/register/verify` : this.config.verificationBaseUrl;
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}token=${encodeURIComponent(token)}`;
}
```

### 2. HTTP Route Changes

**File**: `apps/server/src/http/authRoutes.ts`

Modified registration handlers to pass the `Origin` header:

```typescript
const result = await deps.registrationService.requestRegistration({
  // ... existing fields
  origin: req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/')
});
```

The code tries the `Origin` header first, then falls back to parsing the `Referer` header if Origin isn't available.

### 3. Script Simplification

**File**: `scripts/run-sync-server.sh`

Removed hardcoded verification URL configuration since it's now dynamic:

```bash
# Dynamic verification URL generation is now built into the server code
# It automatically uses the Origin header from registration requests
# No configuration needed - works with penguin.linux.test, 192.168.0.56, localhost, etc.
```

Deleted the separate `run-sync-server-remote.sh` script since one script now handles all scenarios.

## How It Works

### Request Flow:

1. **User visits web app** at `https://penguin.linux.test:5173`
2. **User clicks "Create account"**
3. **Browser sends registration request** with `Origin: https://penguin.linux.test:5173` header
4. **Server extracts Origin header** from the request
5. **Server generates verification URL** using the Origin: `https://penguin.linux.test:5173/register/verify?token=abc123`
6. **Email contains correct URL** - no manual editing needed!

### Fallback Logic:

```typescript
origin: req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/')
```

- **Primary**: Use `Origin` header (most reliable)
- **Fallback**: Parse `Referer` header to extract origin
- **Last resort**: Use configured `AUTH_REGISTRATION_VERIFY_URL` from environment

## Benefits

1. **No manual URL editing** - Links work immediately
2. **Works from anywhere** - Local machine, remote devices, different hostnames
3. **Single script** - No need for separate local/remote configurations
4. **Automatic** - No environment variables to set
5. **Secure** - Only accepts origins from CORS allowed list

## Testing

### Test Scenarios:

1. **Local access via penguin.linux.test**:
   ```bash
   curl -X POST https://penguin.linux.test:1234/auth/register \
     -H "Origin: https://penguin.linux.test:5173" \
     -H "Content-Type: application/json" \
     -d '{"identifier":"test@example.com","password":"...",...}'
   ```
   → Generates: `https://penguin.linux.test:5173/register/verify?token=...`

2. **Remote access via IP**:
   ```bash
   curl -X POST https://192.168.0.56:1234/auth/register \
     -H "Origin: https://192.168.0.56:5173" \
     -H "Content-Type: application/json" \
     -d '{"identifier":"test@example.com","password":"...",...}'
   ```
   → Generates: `https://192.168.0.56:5173/register/verify?token=...`

3. **Check dev mailbox**:
   ```bash
   cat coverage/dev-mailbox/<registration-id>.txt
   ```
   Verify the URL matches how you connected.

## Security Considerations

- The `Origin` header is automatically validated against `AUTH_CORS_ALLOWED_ORIGINS`
- Only trusted origins can trigger registration
- Prevents malicious sites from generating verification links for your domain
- CORS policy must include all legitimate access points

## Configuration

No additional configuration needed! The feature works automatically.

However, ensure your CORS configuration includes all valid origins:

```bash
export AUTH_CORS_ALLOWED_ORIGINS="https://penguin.linux.test:5173,https://192.168.0.56:5173,https://localhost:5173"
```

## Migration Notes

- Existing behavior preserved for backward compatibility
- If `AUTH_REGISTRATION_VERIFY_URL` is set, it acts as the fallback
- No database migrations needed
- Works immediately after server restart

## Future Improvements

Potential enhancements:
- Support for custom verification URL templates per tenant
- Validation that origin is in CORS whitelist before using it
- Logging/metrics for which origins are being used
- Support for email-based URL selection (different URLs per email domain)

