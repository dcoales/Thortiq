import initSqlJs, {type Database, type SqlJsConfig, type SqlJsStatic} from 'sql.js';

import type {SnapshotPersistence} from './types';

export interface SqlJsFileAdapter {
  readonly readFile: (filePath: string) => Promise<Uint8Array | null>;
  readonly writeFile: (filePath: string, data: Uint8Array) => Promise<void>;
  readonly removeFile?: (filePath: string) => Promise<void>;
}

export interface SqlJsSnapshotStoreOptions {
  readonly filePath?: string;
  readonly tableName?: string;
  readonly key?: string;
  readonly locateFile?: SqlJsConfig['locateFile'];
  readonly sqlJs?: SqlJsStatic;
  readonly fileAdapter?: SqlJsFileAdapter;
}

const DEFAULT_TABLE_NAME = 'thortiq_snapshots';
const DEFAULT_KEY = 'current';

const validateIdentifier = (value: string, kind: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error(`Invalid ${kind} "${value}". Only alphanumeric characters and underscores are allowed, and it must not start with a digit.`);
  }
};

const defaultLocateFile: NonNullable<SqlJsConfig['locateFile']> = (file) => {
  try {
    if (typeof require === 'function' && typeof require.resolve === 'function') {
      return require.resolve(`sql.js/dist/${file}`);
    }
  } catch (error) {
    // fall back to direct path below
  }
  return `sql.js/dist/${file}`;
};

const createDefaultFileAdapter = async (): Promise<SqlJsFileAdapter> => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  return {
    async readFile(filePath) {
      try {
        const buffer = await fs.readFile(filePath);
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      } catch (error) {
        const typed = error as NodeJS.ErrnoException;
        if (typed.code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },
    async writeFile(filePath, data) {
      await fs.mkdir(path.dirname(filePath), {recursive: true});
      await fs.writeFile(filePath, data);
    },
    async removeFile(filePath) {
      await fs.rm(filePath, {force: true});
    }
  };
};

const toUint8Array = (value: unknown): Uint8Array | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  return null;
};

export const createSqlJsSnapshotStore = async (
  options: SqlJsSnapshotStoreOptions = {}
): Promise<SnapshotPersistence> => {
  const tableName = options.tableName ?? DEFAULT_TABLE_NAME;
  validateIdentifier(tableName, 'table name');
  const key = options.key ?? DEFAULT_KEY;

  const sqlJs = options.sqlJs ?? (await initSqlJs({locateFile: options.locateFile ?? defaultLocateFile}));
  const fileAdapter = options.fileAdapter ?? (options.filePath ? await createDefaultFileAdapter() : undefined);

  const openDatabase = async (): Promise<Database> => {
    if (options.filePath && fileAdapter) {
      const data = await fileAdapter.readFile(options.filePath);
      return data ? new sqlJs.Database(data) : new sqlJs.Database();
    }
    return new sqlJs.Database();
  };

  const database = await openDatabase();

  database.run(`CREATE TABLE IF NOT EXISTS ${tableName} (id TEXT PRIMARY KEY, data BLOB NOT NULL)`);

  let queue: Promise<unknown> = Promise.resolve();
  const runExclusive = <T>(operation: () => Promise<T> | T): Promise<T> => {
    const result = queue.then(() => operation());
    queue = result.catch((error) => {
      queue = Promise.resolve();
      throw error;
    });
    return result;
  };

  const persistToFile = async () => {
    if (options.filePath && fileAdapter) {
      await fileAdapter.writeFile(options.filePath, database.export());
    }
  };

  const selectSnapshot = (): Uint8Array | null => {
    const statement = database.prepare(`SELECT data FROM ${tableName} WHERE id = ? LIMIT 1`);
    try {
      statement.bind([key]);
      if (!statement.step()) {
        return null;
      }
      const row = statement.getAsObject();
      return toUint8Array(row.data);
    } finally {
      statement.free();
    }
  };

  const upsertSnapshot = (snapshot: Uint8Array) => {
    const statement = database.prepare(
      `INSERT INTO ${tableName} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`
    );
    try {
      statement.bind([key, snapshot]);
      statement.step();
    } finally {
      statement.free();
    }
  };

  const deleteSnapshot = () => {
    const statement = database.prepare(`DELETE FROM ${tableName} WHERE id = ?`);
    try {
      statement.bind([key]);
      statement.step();
    } finally {
      statement.free();
    }
  };

  return {
    async load() {
      const result = await runExclusive(() => selectSnapshot());
      return result ? {update: result} : null;
    },
    async save(snapshot) {
      await runExclusive(async () => {
        upsertSnapshot(new Uint8Array(snapshot.update));
        await persistToFile();
      });
    },
    async clear() {
      await runExclusive(async () => {
        deleteSnapshot();
        await persistToFile();
      });
    }
  };
};

export type SqlJsSnapshotStore = Awaited<ReturnType<typeof createSqlJsSnapshotStore>>;
