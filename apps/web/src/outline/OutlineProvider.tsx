import type { PropsWithChildren } from "react";
import { useMemo } from "react";

import {
  createEphemeralPersistenceFactory,
  createEphemeralProviderFactory,
  createUserDocId,
  createUserStorageNamespace
} from "@thortiq/client-core";
import type { SyncAwarenessState, SyncManager } from "@thortiq/client-core";
import { OutlineProvider as SharedOutlineProvider } from "@thortiq/client-react";
import type { OutlineStoreOptions } from "@thortiq/client-core";
import type { SyncManagerStatus } from "@thortiq/client-core";
import type {
  SessionPaneState,
  SessionState,
  SessionStore,
  SessionStorageAdapter
} from "@thortiq/sync-core";

import { createBrowserSessionAdapter, createBrowserSyncPersistenceFactory } from "./platformAdapters";
import { createWebsocketProviderFactory } from "./websocketProvider";

export interface OutlineProviderOptions {
  readonly userId?: string;
  readonly docId?: string;
  readonly persistenceFactory?: OutlineStoreOptions["persistenceFactory"];
  readonly providerFactory?: OutlineStoreOptions["providerFactory"];
  readonly autoConnect?: boolean;
  readonly awarenessDefaults?: SyncAwarenessState;
  readonly enableAwarenessIndicators?: boolean;
  readonly enableSyncDebugLogging?: boolean;
  readonly seedOutline?: (sync: SyncManager) => void;
  readonly skipDefaultSeed?: boolean;
  readonly sessionAdapter?: SessionStorageAdapter;
}

interface OutlineProviderProps extends PropsWithChildren {
  readonly options?: OutlineProviderOptions;
}

const readEnv = (key: string): string | undefined => {
  const env = (import.meta.env as Record<string, string | undefined> | undefined) ?? undefined;
  const value = env?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const getDefaultEndpoint = (): string => {
  if (typeof window === "undefined") {
    return "ws://localhost:1234/sync/v1/{docId}";
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/sync/v1/{docId}`;
};

const isTestEnvironment = (): boolean => import.meta.env?.MODE === "test";

export const OutlineProvider = ({ options, children }: OutlineProviderProps) => {
  const storeOptions = useMemo(() => {
    const envEndpoint = readEnv("VITE_SYNC_WEBSOCKET_URL");
    const envToken = readEnv("VITE_SYNC_AUTH_TOKEN");
    const envUserId = readEnv("VITE_SYNC_USER_ID") ?? "local";
    const envDisplayName = readEnv("VITE_SYNC_DISPLAY_NAME") ?? envUserId;
    const envColor = readEnv("VITE_SYNC_COLOR") ?? "#4f46e5";
    const effectiveUserId = options?.userId ?? envUserId;
    const docId = options?.docId ?? createUserDocId({ userId: effectiveUserId, type: "outline" });
    const namespace = createUserStorageNamespace({ userId: effectiveUserId });

    const awarenessDefaults: SyncAwarenessState = options?.awarenessDefaults ?? {
      userId: effectiveUserId,
      displayName: envDisplayName,
      color: envColor,
      focusEdgeId: null
    };

    const persistenceFactory =
      options?.persistenceFactory
        ?? (isTestEnvironment()
          ? createEphemeralPersistenceFactory()
          : createBrowserSyncPersistenceFactory({ namespace }));

    const providerFactory =
      options?.providerFactory
        ?? ((isTestEnvironment() || typeof globalThis.WebSocket !== "function")
          ? createEphemeralProviderFactory()
          : createWebsocketProviderFactory({
              endpoint: envEndpoint ?? getDefaultEndpoint(),
              token: envToken
            }));

    const sessionAdapter =
      options?.sessionAdapter ?? createBrowserSessionAdapter({ namespace, userId: effectiveUserId });

    return {
      docId,
      persistenceFactory,
      providerFactory,
      sessionAdapter,
      awarenessDefaults,
      autoConnect: options?.autoConnect,
      skipDefaultSeed: options?.skipDefaultSeed,
      seedOutline: options?.seedOutline,
      enableAwarenessIndicators: options?.enableAwarenessIndicators,
      enableSyncDebugLogging: options?.enableSyncDebugLogging
    } satisfies OutlineStoreOptions;
  }, [options]);

  return (
    <SharedOutlineProvider options={storeOptions} loadingFallback={<div data-testid="outline-loading" />}>
      {children}
    </SharedOutlineProvider>
  );
};

export {
  useOutlineStore,
  useOutlineSnapshot,
  useOutlinePresence,
  useSyncContext,
  useAwarenessIndicatorsEnabled,
  useSyncDebugLoggingEnabled,
  useSyncStatus,
  useOutlineSessionStore,
  useOutlineSessionState,
  useOutlinePaneState,
  useOutlinePaneIds,
  useOutlineActivePaneId
} from "@thortiq/client-react";

export type { SessionPaneState, SessionState, SessionStore, SyncManagerStatus };
export type { OutlinePresenceParticipant, OutlinePresenceSnapshot } from "@thortiq/client-core";
export { seedDefaultOutline } from "@thortiq/client-core";
