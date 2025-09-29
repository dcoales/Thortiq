import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyUpdate, encodeStateAsUpdate } from "yjs";

import type {
  SyncManagerOptions,
  SyncPersistenceAdapter,
  SyncPersistenceContext
} from "@thortiq/client-core";

interface FileSystemLike {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
}

export interface DesktopPersistenceFactoryOptions {
  readonly baseDir?: string;
  readonly fileName?: string;
  readonly fs?: FileSystemLike;
}

type Deferred<T> = {
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
  readonly promise: Promise<T>;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
};

const defaultDataDir = (): string => {
  const home = typeof os.homedir === "function" ? os.homedir() : undefined;
  return path.join(home ?? process.cwd(), ".thortiq", "outline");
};

const toUint8Array = (input: Uint8Array | ArrayBufferLike): Uint8Array => {
  if (input instanceof Uint8Array) {
    return new Uint8Array(input);
  }
  return new Uint8Array(input);
};

const normalizeFs = (customFs?: DesktopPersistenceFactoryOptions["fs"]): FileSystemLike => {
  if (customFs) {
    return customFs;
  }
  return {
    async mkdir(target, options) {
      await fs.mkdir(target, { recursive: true, ...options });
    },
    async readFile(target) {
      const buffer = await fs.readFile(target);
      return new Uint8Array(buffer);
    },
    async writeFile(target, data) {
      await fs.writeFile(target, data);
    }
  } satisfies FileSystemLike;
};

/**
 * Creates a persistence factory for the Electron desktop shell using the local filesystem.
 * The adapter stores the latest Yjs snapshot per document, ensuring offline availability without
 * coupling core sync logic to Node APIs.
 */
export const createDesktopFilePersistenceFactory = (
  options: DesktopPersistenceFactoryOptions = {}
): SyncManagerOptions["persistenceFactory"] => {
  const fsApi = normalizeFs(options.fs);

  return (context: SyncPersistenceContext): SyncPersistenceAdapter => {
    const deferred = createDeferred<void>();
    let started = false;
    const baseDir = path.resolve(options.baseDir ?? defaultDataDir());
    const fileName = options.fileName ?? `${context.docId}.ydoc`;
    const filePath = path.join(baseDir, fileName);

    const hydrate = async () => {
      try {
        const data = await fsApi.readFile(filePath);
        if (data.byteLength > 0) {
          applyUpdate(context.doc, toUint8Array(data), "desktop-persistence");
        }
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === "ENOENT") {
          return;
        }
        throw error;
      }
    };

    const persistSnapshot = async (): Promise<void> => {
      const update = encodeStateAsUpdate(context.doc);
      await fsApi.mkdir(baseDir, { recursive: true });
      await fsApi.writeFile(filePath, new Uint8Array(update));
    };

    const start = async (): Promise<void> => {
      if (started) {
        return deferred.promise;
      }
      started = true;
      try {
        await fsApi.mkdir(baseDir, { recursive: true });
        await hydrate();
        deferred.resolve();
      } catch (error) {
        deferred.reject(error);
        throw error;
      }
    };

    const destroy = async (): Promise<void> => {
      await persistSnapshot();
    };

    const adapter: SyncPersistenceAdapter = {
      start,
      whenReady: deferred.promise,
      flush: persistSnapshot,
      destroy
    };

    return adapter;
  };
};
