import {Router} from 'express';
import type {Request, Response} from 'express';

import {REMOTE_ORIGIN} from '@thortiq/client-core';

import type {SharedDocStore} from '../docStore';

interface DocumentParams {
  readonly docId: string;
}

interface ImportBody {
  readonly update?: string;
}

interface ExportQuery {
  readonly stateVector?: string;
}

const toBase64 = (value: Uint8Array): string => Buffer.from(value).toString('base64');

const fromBase64 = (value: string): Uint8Array => {
  try {
    return new Uint8Array(Buffer.from(value, 'base64'));
  } catch (error) {
    throw new Error('Invalid base64 payload');
  }
};

export const createDocumentRouter = (store: SharedDocStore) => {
  const router = Router();

  router.post('/:docId/import', (req: Request<DocumentParams, unknown, ImportBody>, res: Response) => {
    const {docId} = req.params;
    const {update} = req.body;
    if (typeof update !== 'string' || update.length === 0) {
      res.status(400).json({error: 'invalid_update'});
      return;
    }

    try {
      const decoded = fromBase64(update);
      store.applyUpdate(docId, decoded, REMOTE_ORIGIN);
      const stateVector = store.encodeStateVector(docId);
      res.json({status: 'ok', stateVector: toBase64(stateVector)});
    } catch (error) {
      res.status(400).json({error: 'invalid_payload'});
    }
  });

  router.get('/:docId/export', (req: Request<DocumentParams, unknown, unknown, ExportQuery>, res: Response) => {
    const {docId} = req.params;
    const {stateVector} = req.query;
    try {
      const vector = typeof stateVector === 'string' ? fromBase64(stateVector) : undefined;
      const update = store.encodeState(docId, vector);
      res.json({update: toBase64(update)});
    } catch (error) {
      res.status(400).json({error: 'invalid_request'});
    }
  });

  router.get('/:docId/state-vector', (req: Request<DocumentParams>, res: Response) => {
    const {docId} = req.params;
    try {
      const stateVector = store.encodeStateVector(docId);
      res.json({stateVector: toBase64(stateVector)});
    } catch (error) {
      res.status(400).json({error: 'invalid_request'});
    }
  });

  return router;
};
