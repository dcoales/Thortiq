# Local HTTPS Dev Proxy

This guide explains how to run the web app and sync server on a single Chromebook while presenting
them to browsers as a single HTTPS origin. Vite proxies all `/auth`, `/api`, and `/sync` calls to
the sync server, so the frontend no longer relies on permissive CORS settings during development.

## 1. Generate and trust a dev certificate
- Install [mkcert](https://github.com/FiloSottile/mkcert) (already available on the Chromebook image).
- Create the certificate and key inside `apps/web/certs/`:
  ```bash
  mkcert -cert-file apps/web/certs/dev.local.pem \
         -key-file apps/web/certs/dev.local-key.pem \
         localhost 127.0.0.1 ::1 192.168.1.207
  ```
- Run `mkcert -install` once if the local CA is missing. Do the same on any other client that needs
  to trust the certificate (export the generated CA and install it there).

## 2. Start the sync server
- From the repo root, launch the backend with:
  ```bash
  pnpm sync:server
  ```
- The server listens on `https://127.0.0.1:1234` and uses the certificate configured by
  `scripts/run-sync-server.sh`. No manual CORS configuration is required when the proxy is active.

## 3. Run the Vite dev server with proxying
- Still in the repo root, start Vite:
  ```bash
  pnpm dev
  ```
- Vite serves `https://<device-ip>:5173`, terminating TLS with the certificate from step 1 and proxying
  `/auth`, `/api`, and `/sync` requests (including WebSockets) to the sync server on port 1234.
  Ensure all frontend fetches use relative URLs (e.g. `/auth/login`) so the proxy can intercept them.

## 4. Connect from other devices
- Browse to `https://192.168.1.207:5173` (or the Chromebook’s current LAN IP). Accept the certificate
  warning or install the mkcert root CA on that machine.
- All authentication and sync traffic now flows through the single Vite origin, eliminating the
  CORS errors encountered when targeting the backend port directly.
