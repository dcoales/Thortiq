import {createSessionId, createUserId} from '@thortiq/client-core';

type DesktopBootstrap = {
  readonly sessionId: string;
  readonly userId: string;
};

export const bootstrapDesktopShell = (): DesktopBootstrap => ({
  sessionId: createSessionId(),
  userId: createUserId()
});

