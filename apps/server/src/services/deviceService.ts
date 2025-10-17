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

export interface DeviceUpsertResult {
  readonly device: DeviceRecord;
  readonly created: boolean;
}

export class DeviceService {
  private readonly store: IdentityStore;

  constructor(store: IdentityStore) {
    this.store = store;
  }

  async upsert(options: DeviceUpsertOptions): Promise<DeviceUpsertResult> {
    const now = Date.now();
    const existing = options.deviceId ? await this.store.getDeviceById(options.deviceId) : null;
    const created = !existing;
    const deviceId = options.deviceId ?? `${options.user.id}-${options.platform}-${now}`;
    const device: DeviceRecord = {
      id: deviceId,
      userId: options.user.id,
      displayName: options.displayName,
      platform: options.platform,
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
      trusted: options.trusted,
      metadata: {
        ...(existing?.metadata ?? {}),
        rememberDevice: options.rememberDevice,
        ...options.metadata
      }
    };
    const stored = await this.store.upsertDevice({ device });
    return { device: stored, created };
  }
}
