/**
 * Lightweight JWT decoder used to extract non-sensitive claims (session/device identifiers) from
 * access tokens.  The decoder intentionally skips signature verification because the store only
 * needs the embedded identifiers for client-side state labelling; trust is derived from the server
 * response that accompanied the token.
 */
import type { TokenClaims } from "./types";

const decodeBase64Url = (segment: string): string => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(segment, "base64url").toString("utf8");
  }
  let base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4;
  if (padding > 0) {
    base64 = base64.padEnd(base64.length + (4 - padding), "=");
  }
  if (typeof atob === "function") {
    return decodeURIComponent(
      Array.from(atob(base64))
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join("")
    );
  }
  throw new Error("No base64 decoder available for JWT payloads");
};

export const decodeJwtClaims = (token: string): Partial<TokenClaims> | null => {
  if (typeof token !== "string") {
    return null;
  }
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const payload = decodeBase64Url(parts[1]);
    const claims = JSON.parse(payload) as Partial<TokenClaims>;
    return claims;
  } catch (_error) {
    return null;
  }
};
