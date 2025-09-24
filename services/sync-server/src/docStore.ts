import * as Y from 'yjs';

import {ensureDocumentRoot, MutationOrigin} from '@thortiq/client-core';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {getYDoc} = require('y-websocket/bin/utils') as {
  getYDoc: (docId: string, gc?: boolean) => Y.Doc;
};

export class SharedDocStore {
  private readonly gcEnabled: boolean;

  constructor(options?: Readonly<{gcEnabled?: boolean}>) {
    this.gcEnabled = options?.gcEnabled ?? true;
  }

  get(docId: string): Y.Doc {
    const doc = getYDoc(docId, this.gcEnabled);
    ensureDocumentRoot(doc);
    return doc;
  }

  applyUpdate(docId: string, update: Uint8Array, origin: MutationOrigin): void {
    const doc = this.get(docId);
    Y.applyUpdate(doc, update, origin);
  }

  encodeState(docId: string, stateVector?: Uint8Array): Uint8Array {
    const doc = this.get(docId);
    if (stateVector) {
      return Y.encodeStateAsUpdate(doc, stateVector);
    }
    return Y.encodeStateAsUpdate(doc);
  }

  encodeStateVector(docId: string): Uint8Array {
    const doc = this.get(docId);
    return Y.encodeStateVector(doc);
  }
}
