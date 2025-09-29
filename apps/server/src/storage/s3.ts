import { Buffer } from "node:buffer";

import type { SnapshotStorage } from "./types";

interface S3FactoryOptions {
  readonly region?: string;
  readonly bucket: string;
  readonly prefix?: string;
}

const encodeKey = (docId: string, prefix?: string): string => {
  const safeId = encodeURIComponent(docId);
  return prefix ? `${prefix.replace(/\/$/, "")}/${safeId}.bin` : `${safeId}.bin`;
};

type S3Module = {
  S3Client: new (config: { region?: string }) => {
    send: (command: unknown) => Promise<unknown>;
  };
  GetObjectCommand: new (input: unknown) => unknown;
  PutObjectCommand: new (input: unknown) => unknown;
};

/**
 * Lazily imports the AWS SDK so the dependency is optional when running in test environments.
 */
const loadS3 = async (): Promise<S3Module> => {
  return (await import("@aws-sdk/client-s3")) as S3Module;
};

export const createS3SnapshotStorage = (options: S3FactoryOptions): SnapshotStorage => {
  const { bucket, prefix, region } = options;

  let clientPromise: Promise<{
    S3Client: new (config: { region?: string }) => {
      send: (command: unknown) => Promise<unknown>;
    };
    GetObjectCommand: new (input: unknown) => unknown;
    PutObjectCommand: new (input: unknown) => unknown;
  }> | null = null;

  const ensureClient = async () => {
    if (!clientPromise) {
      clientPromise = loadS3();
    }
    const module = await clientPromise;
    const client = new module.S3Client({ region });
    return {
      client,
      GetObjectCommand: module.GetObjectCommand,
      PutObjectCommand: module.PutObjectCommand
    };
  };

  const readStreamToUint8Array = async (stream: unknown): Promise<Uint8Array> => {
    if (!stream) {
      return new Uint8Array();
    }
    if (stream instanceof Uint8Array) {
      return stream;
    }
    if (typeof (stream as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
      return await (stream as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    }
    const chunks: Uint8Array[] = [];
    return await new Promise<Uint8Array>((resolve, reject) => {
      (stream as NodeJS.ReadableStream)
        .on("data", (chunk: Buffer) => chunks.push(new Uint8Array(chunk)))
        .once("end", () => {
          const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
          const merged = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
          }
          resolve(merged);
        })
        .once("error", reject);
    });
  };

  return {
    async loadSnapshot(docId) {
      const { client, GetObjectCommand } = await ensureClient();
      const Key = encodeKey(docId, prefix);
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key }));
        const body = (result as { Body?: unknown }).Body;
        if (!body) {
          return null;
        }
        const data = await readStreamToUint8Array(body);
        return data.byteLength > 0 ? data : null;
      } catch (error) {
        if ((error as { name?: string }).name === "NoSuchKey") {
          return null;
        }
        throw error;
      }
    },
    async saveSnapshot(docId, snapshot) {
      const { client, PutObjectCommand } = await ensureClient();
      const Key = encodeKey(docId, prefix);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key,
          Body: Buffer.from(snapshot)
        })
      );
    }
  } satisfies SnapshotStorage;
};
