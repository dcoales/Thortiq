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
  if (import.meta.env?.DEV && typeof window !== "undefined" && window.location.port === "5173") {
    return "http://localhost:1234";
  }
  return "";
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
