import {monotonicFactory} from 'ulid';

import type {
  EdgeId,
  NodeId,
  PaneId,
  SessionId,
  TaskId,
  UserId
} from './types';

export type IdGenerator = (timestamp?: number) => string;

const globalFactory = monotonicFactory();

export const createUlid = (timestamp?: number): string => globalFactory(timestamp);

export const createScopedIdGenerator = (): IdGenerator => {
  const factory = monotonicFactory();
  return (timestamp?: number) => factory(timestamp);
};

export const createNodeId = (timestamp?: number): NodeId => createUlid(timestamp);
export const createEdgeId = (timestamp?: number): EdgeId => createUlid(timestamp);
export const createPaneId = (timestamp?: number): PaneId => createUlid(timestamp);
export const createSessionId = (timestamp?: number): SessionId => createUlid(timestamp);
export const createTaskId = (timestamp?: number): TaskId => createUlid(timestamp);
export const createUserId = (timestamp?: number): UserId => createUlid(timestamp);

