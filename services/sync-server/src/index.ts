import {createSessionId, createUserId} from '@thortiq/client-core';

type SyncBootstrap = {
  readonly serverSessionId: string;
  readonly systemUserId: string;
};

export const bootstrapSyncServer = (): SyncBootstrap => ({
  serverSessionId: createSessionId(),
  systemUserId: createUserId()
});

