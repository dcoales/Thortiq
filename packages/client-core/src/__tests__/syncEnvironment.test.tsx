import '@testing-library/jest-dom';
import {render, waitFor} from '@testing-library/react';
import {StrictMode, useEffect} from 'react';

import {
  DOCUMENT_ROOT_ID,
  createThortiqDoc,
  getDefaultSeedTitles,
  initializeCollections,
  useOutlineSync
} from '..';
import type {OutlineSyncOptions} from '../hooks/useOutlineSync';
import type {SyncEnvironment} from '../sync/environment';

interface HarnessProps {
  readonly doc: ReturnType<typeof createThortiqDoc>;
  readonly environment: SyncEnvironment;
  readonly options: OutlineSyncOptions;
  readonly onUpdate: (state: SyncSnapshot) => void;
}

interface SyncSnapshot {
  readonly isReady: boolean;
  readonly token: string | null;
  readonly syncStatus: string;
}

const requireSnapshot = (value: SyncSnapshot | null): SyncSnapshot => {
  if (!value) {
    throw new Error('Sync state did not update');
  }
  return value;
};

const SyncHarness = ({doc, environment, options, onUpdate}: HarnessProps) => {
  const sync = useOutlineSync(doc, environment, options);
  useEffect(() => {
    onUpdate({
      isReady: sync.isReady,
      token: sync.token,
      syncStatus: sync.syncStatus
    });
  }, [onUpdate, sync.isReady, sync.syncStatus, sync.token]);
  return null;
};

const baseOptions: OutlineSyncOptions = {
  tokenStorageKey: 'thortiq:testToken',
  defaultDocId: 'thortiq-outline',
  syncDisabledMessage: 'sync disabled',
  envKeys: {}
};

describe('SyncEnvironment adapters', () => {
  test('bootstraps outline when persistence APIs are unavailable', async () => {
    const doc = createThortiqDoc();
    const environment: SyncEnvironment = {
      now: () => '2024-01-01T00:00:00.000Z',
      storage: undefined,
      timers: undefined,
      fetch: undefined,
      readEnv: () => null,
      getCachedBootstrapConfig: () => null,
      getBootstrapConfig: () => Promise.resolve(null)
    };

    let latest: SyncSnapshot | null = null;
    const onUpdate = (state: SyncSnapshot) => {
      latest = state;
    };

    render(
      <StrictMode>
        <SyncHarness doc={doc} environment={environment} options={baseOptions} onUpdate={onUpdate} />
      </StrictMode>
    );

    await waitFor(() => expect(latest?.isReady).toBe(true));
    const snapshot = requireSnapshot(latest);

    expect(snapshot.token).toBeNull();
    expect(snapshot.syncStatus).toBe('disconnected');

    const {edges} = initializeCollections(doc);
    const rootEdges = edges.get(DOCUMENT_ROOT_ID);
    expect(rootEdges?.length).toBe(getDefaultSeedTitles().length);
  });

  test('falls back to env token when storage throws', async () => {
    const doc = createThortiqDoc();
    const environment: SyncEnvironment = {
      now: () => '2024-01-01T00:00:00.000Z',
      storage: {
        getItem() {
          throw new Error('denied');
        },
        setItem() {
          throw new Error('denied');
        }
      },
      timers: undefined,
      fetch: undefined,
      readEnv: (key) => (key === 'SYNC_TOKEN' ? 'env-token' : null),
      getCachedBootstrapConfig: () => null,
      getBootstrapConfig: () => Promise.resolve(null)
    };

    let latest: SyncSnapshot | null = null;
    const onUpdate = (state: SyncSnapshot) => {
      latest = state;
    };

    const options: OutlineSyncOptions = {
      ...baseOptions,
      envKeys: {token: 'SYNC_TOKEN'}
    };

    render(
      <StrictMode>
        <SyncHarness doc={doc} environment={environment} options={options} onUpdate={onUpdate} />
      </StrictMode>
    );

    await waitFor(() => expect(latest?.isReady).toBe(true));
    const snapshot = requireSnapshot(latest);

    expect(snapshot.token).toBe('env-token');
  });
});
