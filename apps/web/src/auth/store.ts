import { createAuthHttpClient, createAuthStore, type AuthStore } from "@thortiq/client-core";

import { createWebSecureCredentialStorage } from "./secureStorage";

const readEnv = (key: string): string | undefined => {
  const value = (import.meta.env?.[key] as string | undefined) ?? undefined;
  return value && value.length > 0 ? value : undefined;
};

const baseUrl = readEnv("VITE_AUTH_BASE_URL") ?? "";

const httpClient = createAuthHttpClient({
  baseUrl
});

const credentialStorage = createWebSecureCredentialStorage();

export const authStore: AuthStore = createAuthStore({
  httpClient,
  credentialStorage,
  defaultRememberDevice: true
});
