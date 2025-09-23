import type {SnapshotPersistence} from './types';

type FsModule = typeof import('node:fs/promises');
type PathModule = typeof import('node:path');

const ensureNodeEnvironment = () => {
  if (typeof process === 'undefined' || typeof process.versions?.node !== 'string') {
    throw new Error('File system snapshot store is only available in Node.js environments');
  }
};

let fsPromise: Promise<FsModule> | null = null;
let pathPromise: Promise<PathModule> | null = null;

const getFs = (): Promise<FsModule> => {
  ensureNodeEnvironment();
  if (!fsPromise) {
    fsPromise = import('node:fs/promises');
  }
  return fsPromise;
};

const getPath = (): Promise<PathModule> => {
  ensureNodeEnvironment();
  if (!pathPromise) {
    pathPromise = import('node:path');
  }
  return pathPromise;
};

const toUint8Array = (buffer: ArrayBufferView | ArrayBuffer): Uint8Array => {
  if (buffer instanceof Uint8Array) {
    return new Uint8Array(buffer);
  }
  if (buffer instanceof ArrayBuffer) {
    return new Uint8Array(buffer.slice(0));
  }
  const view = buffer;
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
};

export const createFileSystemSnapshotStore = (filePath: string): SnapshotPersistence => {
  const ensureDirectory = async () => {
    const fs = await getFs();
    const path = await getPath();
    await fs.mkdir(path.dirname(filePath), {recursive: true});
  };

  return {
    async load() {
      try {
        const fs = await getFs();
        const data = await fs.readFile(filePath);
        return {update: toUint8Array(data)};
      } catch (error) {
        const typed = error as NodeJS.ErrnoException;
        if (typed.code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },
    async save(snapshot) {
      const fs = await getFs();
      await ensureDirectory();
      await fs.writeFile(filePath, snapshot.update);
    },
    async clear() {
      const fs = await getFs();
      await fs.rm(filePath, {force: true});
    }
  };
};

export type FileSystemSnapshotStore = ReturnType<typeof createFileSystemSnapshotStore>;
