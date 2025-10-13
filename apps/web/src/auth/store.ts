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
  // Default to the current host with port 1234; match page protocol to avoid mixed content
  if (typeof window !== "undefined") {
    const isHttps = window.location.protocol === "https:";
    const protocol = isHttps ? "https" : "http";
    return `${protocol}://${window.location.hostname}:1234`;
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
