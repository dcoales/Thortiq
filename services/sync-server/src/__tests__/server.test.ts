/**
 * @jest-environment node
 */

import request from 'supertest';
// Using supertest without explicit Response typing to avoid unused imports
import * as Y from 'yjs';
import {TextDecoder, TextEncoder} from 'util';

if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder as typeof globalThis.TextEncoder;
}

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
}

import {
  createEdgeId,
  createNodeId,
  createThortiqDoc,
  ensureDocumentRoot,
  insertEdgeRecord,
  initializeCollections,
  upsertNodeRecord
} from '@thortiq/client-core';

import {createSyncServer, createTokenSigner} from '..';

const timestamp = () => new Date().toISOString();
const ensureString = (value: unknown, message: string): string => {
  if (typeof value !== 'string') {
    throw new Error(message);
  }
  return value;
};

interface ProfilePayload {
  readonly profile: {
    readonly id: string;
    readonly displayName: string;
    readonly email?: string;
    readonly avatarUrl?: string;
  };
}

interface ImportPayload {
  readonly status: string;
  readonly stateVector: string;
}

interface ExportPayload {
  readonly update: string;
}

interface HealthPayload {
  readonly status: string;
}

describe('sync server', () => {
  // Keep Jest responsible for timing out async tests to avoid leaving
  // per-request timers (which can cause open handle warnings).
  jest.setTimeout(10000);
  const secret = 'test-secret';
  const server = createSyncServer({jwtSecret: secret});
  const app = server.app;
  const token = createTokenSigner(secret)({
    id: 'user-1',
    displayName: 'Test User'
  });

  afterAll(async () => {
    await server.stop();
  });

  it('responds to health checks', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    const payload = response.body as HealthPayload;
    expect(payload.status).toBe('ok');
  });

  it('rejects unauthenticated profile requests', async () => {
    const response = await request(app).get('/api/profile');
    expect(response.status).toBe(401);
  });

  it('returns the authenticated profile', async () => {
    const response = await request(app)
      .get('/api/profile')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    const payload = response.body as ProfilePayload;
    expect(payload.profile).toEqual({
      id: 'user-1',
      displayName: 'Test User',
      email: undefined,
      avatarUrl: undefined
    });
  });

  it('imports and exports document updates', async () => {
    const doc = createThortiqDoc();
    const root = ensureDocumentRoot(doc);
    const now = timestamp();
    const nodeId = createNodeId();

    upsertNodeRecord(doc, {
      id: nodeId,
      html: 'Hello sync',
      tags: [],
      attributes: {},
      createdAt: now,
      updatedAt: now
    });

    insertEdgeRecord(doc, {
      id: createEdgeId(),
      parentId: root.id,
      childId: nodeId,
      role: 'primary',
      collapsed: false,
      ordinal: 0,
      selected: false,
      createdAt: now,
      updatedAt: now
    });

    const update = Y.encodeStateAsUpdate(doc);
    const updateBase64 = Buffer.from(update).toString('base64');

    const importResponse = await request(app)
      .post('/api/documents/test-doc/import')
      .set('Authorization', `Bearer ${token}`)
      .send({update: updateBase64});

    expect(importResponse.status).toBe(200);
    const importPayload = importResponse.body as ImportPayload;
    expect(importPayload.status).toBe('ok');
    const stateVector = ensureString(importPayload.stateVector, 'Expected state vector');
    expect(stateVector.length).toBeGreaterThan(0);

    const exportResponse = await request(app)
      .get('/api/documents/test-doc/export')
      .set('Authorization', `Bearer ${token}`);

    expect(exportResponse.status).toBe(200);
    const exportPayload = exportResponse.body as ExportPayload;
    const exportedUpdate = ensureString(exportPayload.update, 'Expected base64 update');
    const exported = Buffer.from(exportedUpdate, 'base64');
    const mirroredDoc = createThortiqDoc();
    Y.applyUpdate(mirroredDoc, exported);

    const {nodes} = initializeCollections(mirroredDoc);
    const mirroredNode = nodes.get(nodeId);
    expect(mirroredNode?.html).toBe('Hello sync');
  });
});
