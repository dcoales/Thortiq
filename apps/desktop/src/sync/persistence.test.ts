import { describe, expect, it, vi } from "vitest";
import { encodeStateAsUpdate } from "yjs";

import { addEdge, createNode, createOutlineDoc } from "@thortiq/client-core";

import { createDesktopFilePersistenceFactory } from "./persistence";

type FsWriteData = Uint8Array;

describe("createDesktopFilePersistenceFactory", () => {
  const createFsMock = () => {
    const files = new Map<string, FsWriteData>();

    const fsMock = {
      mkdir: vi.fn(async () => {}),
      readFile: vi.fn(async (filePath: string) => {
        if (!files.has(filePath)) {
          const error = new Error("not found") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
        return files.get(filePath)!;
      }),
      writeFile: vi.fn(async (filePath: string, data: Uint8Array) => {
        files.set(filePath, new Uint8Array(data));
      })
    };

    return { fsMock, files };
  };

  it("hydrates the document from disk and persists changes", async () => {
    const source = createOutlineDoc();
    const nodeId = createNode(source, { text: "Persisted" });
    addEdge(source, { parentNodeId: null, childNodeId: nodeId });

    const update = encodeStateAsUpdate(source.doc);

    const { fsMock, files } = createFsMock();
    const filePath = "/tmp/thortiq/test.ydoc";
    files.set(filePath, new Uint8Array(update));

    const factory = createDesktopFilePersistenceFactory({
      baseDir: "/tmp/thortiq",
      fileName: "test.ydoc",
      fs: fsMock
    });

    const target = createOutlineDoc();
    const adapter = factory({ docId: "test", doc: target.doc });

    await adapter.start();
    await adapter.whenReady;

    expect(target.nodes.has(nodeId)).toBe(true);

    const newNodeId = createNode(target, { text: "Updated" });
    addEdge(target, { parentNodeId: null, childNodeId: newNodeId });

    await adapter.flush?.();

    const stored = files.get(filePath);
    expect(stored).toBeDefined();
    expect(stored?.byteLength).toBeGreaterThan(0);
  });
});
