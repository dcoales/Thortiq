import { createHmac, timingSafeEqual } from "node:crypto";

export interface AuthResult {
  readonly userId: string;
}

export interface AuthOptions {
  readonly sharedSecret: string;
}

interface ParsedToken {
  readonly userId: string;
  readonly signature: string;
}

const parseToken = (token: string): ParsedToken | null => {
  const parts = token.split(":");
  if (parts.length !== 2) {
    return null;
  }
  const [userId, signature] = parts;
  if (!userId || !signature) {
    return null;
  }
  return { userId, signature } satisfies ParsedToken;
};

const createSignature = (secret: string, userId: string): Buffer => {
  return createHmac("sha256", secret).update(userId).digest();
};

/**
 * Validates a raw sync token (`<userId>:<signature>`) generated using the shared secret.
 */
export const verifySyncToken = (token: string | undefined, options: AuthOptions): AuthResult | null => {
  if (!token) {
    return null;
  }
  const parsed = parseToken(token.trim());
  if (!parsed) {
    return null;
  }
  const expected = createSignature(options.sharedSecret, parsed.userId);
  const provided = Buffer.from(parsed.signature, "base64url");
  if (expected.byteLength !== provided.byteLength) {
    return null;
  }
  if (!timingSafeEqual(expected, provided)) {
    return null;
  }
  return { userId: parsed.userId } satisfies AuthResult;
};

/**
 * Accepts `Authorization: Bearer <token>` headers and validates them with {@link verifySyncToken}.
 */
export const verifyAuthorizationHeader = (
  header: string | undefined,
  options: AuthOptions
): AuthResult | null => {
  if (!header) {
    return null;
  }
  const match = header.match(/^Bearer\s+(.*)$/i);
  if (!match) {
    return null;
  }
  return verifySyncToken(match[1], options);
};
