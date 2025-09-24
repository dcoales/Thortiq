import {createSessionId, createUserId} from '@thortiq/client-core';

export type {SyncServerOptions} from './config';
export type {SyncServer} from './server';
export type {JwtClaims, AuthenticatedRequest, AuthenticatedUser} from './auth';
export {createAuthMiddleware, createTokenSigner, verifyToken} from './auth';
export {SharedDocStore} from './docStore';
export {createSyncServer} from './server';

export type SyncBootstrap = {
  readonly serverSessionId: string;
  readonly systemUserId: string;
};

export const bootstrapSyncServer = (): SyncBootstrap => ({
  serverSessionId: createSessionId(),
  systemUserId: createUserId()
});

