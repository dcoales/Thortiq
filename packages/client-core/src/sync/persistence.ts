/**
 * Shared helpers for building persistence adapters that satisfy the SyncManager contract without
 * coupling to platform-specific storage APIs. Downstream apps provide concrete implementations
 * (IndexedDB, filesystem, AsyncStorage) while tests can rely on the ephemeral factory exported here.
 */
import type { SyncManagerOptions, SyncPersistenceAdapter } from "./SyncManager";

/**
 * Returns a `persistenceFactory` that keeps all data in-memory. Useful for unit tests and
 * environments where durable storage is either unavailable or undesirable (e.g. Storybook).
 */
export const createEphemeralPersistenceFactory = (): SyncManagerOptions["persistenceFactory"] => {
  return () => {
    const whenReady = Promise.resolve();
    return {
      async start() {
        // no-op
      },
      whenReady,
      async destroy() {
        // no-op
      }
    } satisfies SyncPersistenceAdapter;
  };
};
