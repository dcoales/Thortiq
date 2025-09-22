import {createPaneId, createSessionId} from '@thortiq/client-core';

type BootstrapIdentifiers = {
  readonly paneId: string;
  readonly sessionId: string;
};

export const bootstrapWebApp = (): BootstrapIdentifiers => ({
  paneId: createPaneId(),
  sessionId: createSessionId()
});

