/**
 * Declares the platform-agnostic environment contract used by shared sync
 * helpers.  UI shells provide an implementation that wraps platform APIs
 * (storage, timers, networking, bootstrap configuration) so the core package
 * can coordinate persistence and websocket bootstrap without touching globals.
 */
export interface LocalSyncBootstrap {
  readonly serverUrl?: string;
  readonly httpUrl?: string;
  readonly docId?: string;
  readonly token?: string;
}

export interface SyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SyncTimers {
  setTimeout(handler: () => void, delay: number): number;
  clearTimeout(id: number): void;
}

export type SyncFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

export interface SyncEnvironment {
  readonly now: () => string;
  readonly storage?: SyncStorage;
  readonly timers?: SyncTimers;
  readonly fetch?: SyncFetch;
  readonly readEnv: (key: string) => string | null;
  readonly getCachedBootstrapConfig?: () => LocalSyncBootstrap | null;
  readonly getBootstrapConfig: () => Promise<LocalSyncBootstrap | null>;
  readonly cacheBootstrapConfig?: (config: LocalSyncBootstrap) => void;
}

export const trimTrailingSlash = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  return value.replace(/\/$/, '');
};

export const deriveHttpUrl = (wsUrl: string | null | undefined): string | null => {
  if (!wsUrl) {
    return null;
  }
  try {
    const url = new URL(wsUrl);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch (_error) {
    return null;
  }
};
