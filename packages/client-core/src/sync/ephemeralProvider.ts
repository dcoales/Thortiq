import type {
  SyncManagerOptions,
  SyncProviderAdapter,
  SyncProviderError,
  SyncProviderStatus
} from "./SyncManager";

class EphemeralProvider implements SyncProviderAdapter {
  public status: SyncProviderStatus = "disconnected";

  private readonly statusListeners = new Set<(status: SyncProviderStatus) => void>();
  private readonly updateListeners = new Set<(update: Uint8Array) => void>();
  private readonly awarenessListeners = new Set<(payload: Uint8Array) => void>();
  private readonly errorListeners = new Set<(error: SyncProviderError) => void>();

  connect(): Promise<void> {
    this.setStatus("connecting");
    this.setStatus("connected");
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.setStatus("disconnected");
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    this.statusListeners.clear();
    this.updateListeners.clear();
    this.awarenessListeners.clear();
    this.errorListeners.clear();
    this.status = "disconnected";
    return Promise.resolve();
  }

  sendUpdate(): void {
    // no-op
  }

  broadcastAwareness(): void {
    // no-op
  }

  onUpdate(listener: (update: Uint8Array) => void): () => void {
    this.updateListeners.add(listener);
    return () => this.updateListeners.delete(listener);
  }

  onAwareness(listener: (payload: Uint8Array) => void): () => void {
    this.awarenessListeners.add(listener);
    return () => this.awarenessListeners.delete(listener);
  }

  onStatusChange(listener: (status: SyncProviderStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onError(listener: (error: SyncProviderError) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  private setStatus(next: SyncProviderStatus): void {
    if (this.status === next) {
      return;
    }
    this.status = next;
    this.statusListeners.forEach((listener) => listener(next));
  }
}

export const createEphemeralProviderFactory = (): SyncManagerOptions["providerFactory"] =>
  () => new EphemeralProvider();
