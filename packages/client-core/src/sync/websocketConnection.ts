import {Awareness} from 'y-protocols/awareness';
import {WebsocketProvider} from 'y-websocket';
import type * as Y from 'yjs';

type StatusHandler = (status: 'connected' | 'connecting' | 'disconnected') => void;

export interface SyncAwarenessState {
  readonly userId: string;
  readonly displayName: string;
  readonly color?: string;
}

export interface WebsocketSyncOptions {
  readonly serverUrl: string;
  readonly docId: string;
  readonly token: string;
  readonly doc: Y.Doc;
  readonly awarenessState?: SyncAwarenessState;
  readonly disableBroadcastChannel?: boolean;
}

export interface WebsocketSyncConnection {
  readonly provider: WebsocketProvider;
  readonly awareness: Awareness;
  readonly disconnect: () => void;
  readonly setAwarenessState: (state: SyncAwarenessState | null) => void;
  readonly subscribeStatus: (handler: StatusHandler) => () => void;
}

const toAwarenessPayload = (state: SyncAwarenessState | null): Record<string, unknown> | null => {
  if (!state) {
    return null;
  }
  return {
    userId: state.userId,
    displayName: state.displayName,
    color: state.color
  };
};

export const createWebsocketSyncConnection = (options: WebsocketSyncOptions): WebsocketSyncConnection => {
  const provider = new WebsocketProvider(options.serverUrl, options.docId, options.doc, {
    params: {token: options.token},
    disableBc: options.disableBroadcastChannel ?? true
  });

  const awareness = provider.awareness;
  if (options.awarenessState) {
    awareness.setLocalState(toAwarenessPayload(options.awarenessState));
  }

  const disconnect = () => {
    awareness.setLocalState(null);
    provider.destroy();
  };

  const setAwarenessState = (state: SyncAwarenessState | null) => {
    awareness.setLocalState(toAwarenessPayload(state));
  };

  const subscribeStatus = (handler: StatusHandler) => {
    const callback = (event: {status: string}) => {
      const status = event.status as 'connected' | 'connecting' | 'disconnected';
      handler(status);
    };
    provider.on('status', callback);
    return () => {
      provider.off('status', callback);
    };
  };

  return {
    provider,
    awareness,
    disconnect,
    setAwarenessState,
    subscribeStatus
  };
};
