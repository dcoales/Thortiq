import { createHmac, timingSafeEqual } from "node:crypto";

export interface AuthResult {
  readonly userId: string;
}

export interface AuthOptions {
  readonly sharedSecret: string;
}

const parseToken = (token: string): { userId: string; signature: string } | null => {
  const parts = token.split(":");
  if (parts.length !== 2) {
    return null;
  }
  const [userId, signature] = parts;
  if (!userId || !signature) {
    return null;
  }
  return { userId, signature };
};

const createSignature = (secret: string, userId: string): Buffer => {
  return createHmac("sha256", secret).update(userId).digest();
};

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
  const token = match[1].trim();
  const parsed = parseToken(token);
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
  return { userId: parsed.userId };
};
