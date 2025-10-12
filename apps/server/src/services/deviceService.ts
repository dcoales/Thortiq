import type { DeviceRecord, UserProfile } from "@thortiq/client-core";

import type { IdentityStore } from "../identity/types";

export interface DeviceUpsertOptions {
  readonly user: UserProfile;
  readonly deviceId?: string;
  readonly displayName: string;
  readonly platform: string;
  readonly trusted: boolean;
  readonly rememberDevice: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class DeviceService {
  private readonly store: IdentityStore;

  constructor(store: IdentityStore) {
    this.store = store;
  }

  async upsert(options: DeviceUpsertOptions): Promise<DeviceRecord> {
    const now = Date.now();
    const device: DeviceRecord = {
      id: options.deviceId ?? `${options.user.id}-${options.platform}-${Date.now()}`,
      userId: options.user.id,
      displayName: options.displayName,
      platform: options.platform,
      createdAt: now,
      lastSeenAt: now,
      trusted: options.trusted,
      metadata: {
        rememberDevice: options.rememberDevice,
        ...options.metadata
      }
    };
    return this.store.upsertDevice({ device });
  }
}
