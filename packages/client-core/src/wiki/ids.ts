/**
 * Wiki IDs
 *
 * ULID-based id factory for wiki links. Keep pure and independent from Yjs.
 */
import {createUlid, createScopedIdGenerator} from '../ids';
import type {WikiLinkId} from './types';

export const createWikiLinkId = (timestamp?: number): WikiLinkId => createUlid(timestamp);

export const createScopedWikiLinkIdFactory = () => {
  const gen = createScopedIdGenerator();
  return (timestamp?: number): WikiLinkId => gen(timestamp);
};

