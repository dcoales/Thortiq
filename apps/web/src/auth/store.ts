import { createAuthHttpClient, createAuthStore, type AuthStore } from "@thortiq/client-core";

import { createWebSecureCredentialStorage } from "./secureStorage";

const readEnv = (key: string): string | undefined => {
  const value = (import.meta.env?.[key] as string | undefined) ?? undefined;
  return value && value.length > 0 ? value : undefined;
};

const resolveBaseUrl = (): string => {
  const envUrl = readEnv("VITE_AUTH_BASE_URL");
  if (envUrl) {
    return envUrl;
  }
  // Default to the current origin so the active dev/proxy server can route requests without CORS.
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://localhost:1234";
};

const baseUrl = resolveBaseUrl();

const httpClient = createAuthHttpClient({
  baseUrl
});

const credentialStorage = createWebSecureCredentialStorage();

export const authStore: AuthStore = createAuthStore({
  httpClient,
  credentialStorage,
  defaultRememberDevice: true
});
