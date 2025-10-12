import type { IncomingMessage, ServerResponse } from "node:http";

export interface ParsedRequestBody<T> {
  readonly data: T;
}

const MAX_BODY_SIZE = 1_048_576; // 1 MiB

export const readJsonBody = async <T>(req: IncomingMessage): Promise<T | null> => {
  return new Promise<T | null>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_SIZE) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", (error) => {
      reject(error);
    });
  });
};

export interface JsonResponseOptions {
  readonly status?: number;
  readonly headers?: Record<string, string>;
}

export const sendJson = (res: ServerResponse, data: unknown, options: JsonResponseOptions = {}): void => {
  const status = options.status ?? 200;
  const baseHeaders: Record<string, string | string[]> = {
    "Content-Type": "application/json; charset=utf-8"
  };
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      baseHeaders[key] = value;
    }
  }
  res.writeHead(status, baseHeaders);
  res.end(JSON.stringify(data));
};

export interface CookieOptions {
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: "Strict" | "Lax" | "None";
  readonly path?: string;
  readonly maxAgeSeconds?: number;
  readonly expiresAt?: number;
  readonly domain?: string;
}

export const serializeCookie = (name: string, value: string, options: CookieOptions = {}): string => {
  const segments = [`${name}=${value}`];
  if (options.path) {
    segments.push(`Path=${options.path}`);
  } else {
    segments.push("Path=/");
  }
  if (options.domain) {
    segments.push(`Domain=${options.domain}`);
  }
  if (options.httpOnly !== false) {
    segments.push("HttpOnly");
  }
  if (options.secure) {
    segments.push("Secure");
  }
  if (options.sameSite) {
    segments.push(`SameSite=${options.sameSite}`);
  } else {
    segments.push("SameSite=Lax");
  }
  if (options.maxAgeSeconds !== undefined) {
    segments.push(`Max-Age=${Math.floor(options.maxAgeSeconds)}`);
  }
  if (options.expiresAt !== undefined) {
    segments.push(`Expires=${new Date(options.expiresAt).toUTCString()}`);
  }
  return segments.join("; ");
};

export const parseCookies = (header: string | undefined): Record<string, string> => {
  if (!header) {
    return {};
  }
  return header.split(";").reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) {
      return acc;
    }
    acc[rawKey] = decodeURIComponent(rawValue.join("="));
    return acc;
  }, {});
};
