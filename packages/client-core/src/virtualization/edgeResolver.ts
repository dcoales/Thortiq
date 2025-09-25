import * as Y from 'yjs';

import {initializeCollections} from '../yjs/doc';
import type {EdgeRecord, NodeId, OutlineChildResolver} from '../types';

const isEdgeArray = (value: unknown): value is Y.Array<EdgeRecord> => value instanceof Y.Array;

type EdgeMapChangeAction = 'add' | 'update' | 'delete';

interface EdgeMapChange {
  readonly action: EdgeMapChangeAction;
  readonly oldValue?: unknown;
}

/**
 * Maintains an incremental cache of outline edge lists backed by Yjs events so
 * tree consumers can resolve children without cloning the entire edge map on
 * every snapshot rebuild.
 */
export class OutlineEdgeResolver {
  private readonly doc: Y.Doc;
  private readonly edges: Y.Map<Y.Array<EdgeRecord>>;
  private readonly edgeCache = new Map<NodeId, readonly EdgeRecord[]>();
  private readonly observers = new Map<NodeId, {
    readonly array: Y.Array<EdgeRecord>;
    readonly listener: (event: Y.YArrayEvent<EdgeRecord>) => void;
  }>();
  private readonly perParentReindexCounts = new Map<NodeId, number>();
  private totalReindexCount = 0;
  private disposed = false;

  private readonly handleEdgesEvent = (event: Y.YMapEvent<Y.Array<EdgeRecord>>): void => {
    event.changes.keys.forEach((rawChange, rawKey) => {
      const parentId: NodeId = rawKey;
      const change = rawChange as EdgeMapChange;
      if (!change || typeof change.action !== 'string') {
        return;
      }
      switch (change.action) {
        case 'add':
        case 'update': {
          const nextArray = this.edges.get(parentId);
          if (!nextArray) {
            return;
          }

          if (change.action === 'update') {
            const oldArray: unknown = change.oldValue;
            if (isEdgeArray(oldArray)) {
              this.detachObserver(parentId, oldArray);
            }
          }

          this.attachObserver(parentId, nextArray);
          break;
        }
        case 'delete': {
          const oldArray: unknown = change.oldValue;
          if (isEdgeArray(oldArray)) {
            this.detachObserver(parentId, oldArray);
          }
          this.edgeCache.delete(parentId);
          this.perParentReindexCounts.delete(parentId);
          break;
        }
        default:
          break;
      }
    });
  };

  private readonly handleDocDestroy = (): void => {
    this.dispose();
  };

  private readonly childResolver: OutlineChildResolver = (parentId) => {
    return this.edgeCache.get(parentId) ?? EMPTY_EDGES;
  };

  public constructor(doc: Y.Doc) {
    const {edges} = initializeCollections(doc);
    this.doc = doc;
    this.edges = edges;

    edges.forEach((edgeArray, key: NodeId) => {
      this.attachObserver(key, edgeArray);
    });

    edges.observe(this.handleEdgesEvent);
    doc.on('destroy', this.handleDocDestroy);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.edges.unobserve(this.handleEdgesEvent);
    this.doc.off('destroy', this.handleDocDestroy);

    this.observers.forEach(({array, listener}, parentId) => {
      array.unobserve(listener);
      this.edgeCache.delete(parentId);
    });

    this.observers.clear();
    this.perParentReindexCounts.clear();
    this.totalReindexCount = 0;
    resolverRegistry.delete(this.doc);
  }

  public resolve(parentId: NodeId): readonly EdgeRecord[] {
    return this.childResolver(parentId);
  }

  public getChildResolver(): OutlineChildResolver {
    return this.childResolver;
  }

  public getDebugStats(): OutlineEdgeResolverDebugSnapshot {
    return {
      totalReindexCount: this.totalReindexCount,
      perParentReindexCounts: new Map(this.perParentReindexCounts)
    };
  }

  private attachObserver(parentId: NodeId, edgeArray: Y.Array<EdgeRecord>): void {
    const existing = this.observers.get(parentId);
    if (existing && existing.array === edgeArray) {
      return;
    }

    if (existing) {
      existing.array.unobserve(existing.listener);
    }

    const listener: (event: Y.YArrayEvent<EdgeRecord>) => void = () => {
      this.reindexParent(parentId, edgeArray);
    };

    edgeArray.observe(listener);
    this.observers.set(parentId, {array: edgeArray, listener});
    this.reindexParent(parentId, edgeArray);
  }

  private detachObserver(parentId: NodeId, edgeArray: Y.Array<EdgeRecord>): void {
    const current = this.observers.get(parentId);
    if (!current) {
      return;
    }

    if (current.array === edgeArray) {
      current.array.unobserve(current.listener);
      this.observers.delete(parentId);
    }
  }

  private reindexParent(parentId: NodeId, edgeArray: Y.Array<EdgeRecord>): void {
    this.edgeCache.set(parentId, edgeArray.toArray());
    this.totalReindexCount += 1;
    const existingCount = this.perParentReindexCounts.get(parentId) ?? 0;
    this.perParentReindexCounts.set(parentId, existingCount + 1);
  }
}

export interface OutlineEdgeResolverDebugSnapshot {
  readonly totalReindexCount: number;
  readonly perParentReindexCounts: ReadonlyMap<NodeId, number>;
}

const resolverRegistry = new WeakMap<Y.Doc, OutlineEdgeResolver>();

export const getOutlineEdgeResolver = (doc: Y.Doc): OutlineEdgeResolver => {
  const existing = resolverRegistry.get(doc);
  if (existing) {
    return existing;
  }

  const resolver = new OutlineEdgeResolver(doc);
  resolverRegistry.set(doc, resolver);
  return resolver;
};

const EMPTY_EDGES: readonly EdgeRecord[] = Object.freeze([]);
