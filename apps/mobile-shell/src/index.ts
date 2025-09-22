import {createPaneId, createUserId} from '@thortiq/client-core';

type MobileBootstrap = {
  readonly paneId: string;
  readonly userId: string;
};

export const bootstrapMobileShell = (): MobileBootstrap => ({
  paneId: createPaneId(),
  userId: createUserId()
});

