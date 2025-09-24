import * as Y from 'yjs';

import type {Command} from './types';
import {initializeCollections, createResolverFromDoc, MutationOrigin} from '../yjs/doc';
import {wouldCreateCycle} from '../invariants';
import type {EdgeId, EdgeRecord, IsoTimestamp, NodeId, NodeRecord} from '../types';
import type {UndoManagerContext} from '../yjs/undo';
import {LOCAL_ORIGIN} from '../yjs/undo';
import {htmlToPlainText, plainTextToHtml} from '../utils/text';

interface EdgeLocation {
  readonly parentId: NodeId;
  readonly index: number;
  readonly edge: EdgeRecord;
  readonly array: Y.Array<EdgeRecord>;
}

interface CommandBusOptions {
  readonly origin?: MutationOrigin;
}

const clampIndex = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export class CommandBus {
  private readonly doc: Y.Doc;
  private readonly undoManager: Y.UndoManager;
  private readonly origin: MutationOrigin;

  constructor(doc: Y.Doc, undoContext: UndoManagerContext, options?: CommandBusOptions) {
    this.doc = doc;
    this.undoManager = undoContext.undoManager;
    this.origin = options?.origin ?? LOCAL_ORIGIN;
  }

  execute(command: Command): void {
    this.doc.transact(() => {
      const collections = initializeCollections(this.doc);
      this.applyCommand(collections, command);
    }, this.origin);
  }

  executeAll(commands: readonly Command[]): void {
    if (commands.length === 0) {
      return;
    }
    this.doc.transact(() => {
      const collections = initializeCollections(this.doc);
      commands.forEach((command) => {
        this.applyCommand(collections, command);
      });
    }, this.origin);
  }

  undo(): void {
    this.undoManager.undo();
  }

  redo(): void {
    this.undoManager.redo();
  }

  private applyCommand(collections: ReturnType<typeof initializeCollections>, command: Command): void {
    switch (command.kind) {
      case 'create-node':
        this.applyCreateNode(collections, command);
        break;
      case 'update-node':
        this.applyUpdateNode(collections, command);
        break;
      case 'delete-node':
        this.applyDeleteNode(collections, command);
        break;
      case 'move-node':
        this.applyMoveNode(collections, command);
        break;
      case 'set-edge-collapsed':
        this.applySetEdgeCollapsed(collections, command);
        break;
      case 'indent-node':
        this.applyIndentNode(collections, command);
        break;
      case 'outdent-node':
        this.applyOutdentNode(collections, command);
        break;
      case 'merge-node-into-previous':
        this.applyMergeNodeIntoPrevious(collections, command);
        break;
      case 'delete-edges':
        this.applyDeleteEdges(collections, command);
        break;
      case 'upsert-session':
        this.applyUpsertSession(collections, command);
        break;
    }
  }

  private applyCreateNode(
    collections: ReturnType<typeof initializeCollections>,
    command: Command & {kind: 'create-node'}
  ): void {
    const {node, edge} = command;
    collections.nodes.set(node.id, node);
    const initialText = command.initialText ?? htmlToPlainText(node.html);
    const text = this.ensureNodeText(collections, node.id);
    text.delete(0, text.length);
    if (initialText.length > 0) {
      text.insert(0, initialText);
    }
    this.insertEdge(collections, edge.parentId, edge);
  }

  private applyUpdateNode(collections: ReturnType<typeof initializeCollections>, command: Command & {kind: 'update-node'}): void {
    const existing = collections.nodes.get(command.nodeId);
    if (!existing) {
      throw new Error(`Node ${command.nodeId} not found`);
    }

    const updated: NodeRecord = {
      ...existing,
      ...('html' in command.patch ? {html: command.patch.html ?? existing.html} : {}),
      ...('tags' in command.patch ? {tags: command.patch.tags ?? existing.tags} : {}),
      ...('attributes' in command.patch
        ? {attributes: command.patch.attributes ?? existing.attributes}
        : {}),
      ...('task' in command.patch ? {task: command.patch.task} : {}),
      updatedAt: command.patch.updatedAt
    };

    collections.nodes.set(command.nodeId, updated);

    if ('html' in command.patch && typeof command.patch.html === 'string') {
      const textValue = htmlToPlainText(command.patch.html);
      const text = this.ensureNodeText(collections, command.nodeId);
      text.delete(0, text.length);
      if (textValue.length > 0) {
        text.insert(0, textValue);
      }
    }
  }

  private applyDeleteNode(collections: ReturnType<typeof initializeCollections>, command: Command & {kind: 'delete-node'}): void {
    this.detachFromParents(collections, command.nodeId, command.timestamp);
    this.deleteSubtree(collections, command.nodeId, command.timestamp);
  }

  private applyMoveNode(collections: ReturnType<typeof initializeCollections>, command: Command & {kind: 'move-node'}): void {
    const location = this.findEdgeLocation(collections, command.edgeId);
    if (!location) {
      throw new Error(`Edge ${command.edgeId} not found`);
    }

    const resolver = createResolverFromDoc(this.doc);
    if (wouldCreateCycle(resolver, location.edge.childId, command.targetParentId)) {
      throw new Error('Cycle detected while moving edge');
    }

    this.removeEdgeAt(collections, location.parentId, location.index, command.timestamp);

    const nextEdge: EdgeRecord = {
      ...location.edge,
      parentId: command.targetParentId,
      ordinal: clampIndex(command.targetOrdinal ?? Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER),
      selected: this.isEdgeSelected(collections, location.edge.id),
      updatedAt: command.timestamp
    };

    this.insertEdge(collections, command.targetParentId, nextEdge);
  }

  private applySetEdgeCollapsed(
    collections: ReturnType<typeof initializeCollections>,
    command: Command & {kind: 'set-edge-collapsed'}
  ): void {
    const location = this.findEdgeLocation(collections, command.edgeId);
    if (!location) {
      throw new Error(`Edge ${command.edgeId} not found`);
    }

    if (location.edge.collapsed === command.collapsed) {
      if (location.edge.updatedAt === command.timestamp) {
        return;
      }
    }

    const nextEdge: EdgeRecord = {
      ...location.edge,
      collapsed: command.collapsed,
      updatedAt: command.timestamp
    };

    location.array.delete(location.index, 1);
    location.array.insert(location.index, [nextEdge]);
    this.normalizeEdgeArray(collections, location.parentId, location.array, command.timestamp);
  }

  private applyIndentNode(collections: ReturnType<typeof initializeCollections>, command: Command & {kind: 'indent-node'}): void {
    const location = this.findEdgeLocation(collections, command.edgeId);
    if (!location) {
      throw new Error(`Edge ${command.edgeId} not found`);
    }

    if (location.index === 0) {
      return;
    }

    const previousEdge = location.array.get(location.index - 1) as EdgeRecord | undefined;
    if (!previousEdge) {
      return;
    }

    if (previousEdge.collapsed) {
      // Ensure the new parent is expanded so the indented node stays visible.
      this.applySetEdgeCollapsed(collections, {
        kind: 'set-edge-collapsed',
        edgeId: previousEdge.id,
        collapsed: false,
        timestamp: command.timestamp
      });
    }

    const childEdges = this.ensureEdgeArray(collections, previousEdge.childId);
    const targetOrdinal = childEdges.length;

    this.applyMoveNode(collections, {
      kind: 'move-node',
      edgeId: command.edgeId,
      targetParentId: previousEdge.childId,
      targetOrdinal,
      timestamp: command.timestamp
    });
  }

  private applyOutdentNode(collections: ReturnType<typeof initializeCollections>, command: Command & {kind: 'outdent-node'}): void {
    const location = this.findEdgeLocation(collections, command.edgeId);
    if (!location) {
      throw new Error(`Edge ${command.edgeId} not found`);
    }

    const parentLocation = this.findParentEdgeLocation(collections, location.parentId);
    if (!parentLocation) {
      return;
    }

    this.applyMoveNode(collections, {
      kind: 'move-node',
      edgeId: command.edgeId,
      targetParentId: parentLocation.parentId,
      targetOrdinal: parentLocation.index + 1,
      timestamp: command.timestamp
    });
  }

  private applyUpsertSession(collections: ReturnType<typeof initializeCollections>, command: Command & {kind: 'upsert-session'}): void {
    collections.sessions.set(command.session.id, command.session);
  }

  private applyMergeNodeIntoPrevious(
    collections: ReturnType<typeof initializeCollections>,
    command: Command & {kind: 'merge-node-into-previous'}
  ): void {
    const location = this.findEdgeLocation(collections, command.edgeId);
    if (!location || location.index === 0) {
      return;
    }

    const previousEdge = location.array.get(location.index - 1) as EdgeRecord | undefined;
    if (!previousEdge) {
      return;
    }

    const {edges, nodes, nodeTexts} = collections;
    const currentChildren = edges.get(location.edge.childId);
    const previousChildren = edges.get(previousEdge.childId);

    if (currentChildren && currentChildren.length > 0 && previousChildren && previousChildren.length > 0) {
      return;
    }

    const currentNode = nodes.get(location.edge.childId);
    const previousNode = nodes.get(previousEdge.childId);

    if (!currentNode || !previousNode) {
      return;
    }

    const previousText = htmlToPlainText(previousNode.html);
    const currentText = htmlToPlainText(currentNode.html);

    const needsSeparator = previousText.length > 0 &&
      currentText.length > 0 &&
      !/\s$/.test(previousText) &&
      !/^\s/.test(currentText);
    const mergedPlain = needsSeparator
      ? `${previousText} ${currentText}`
      : `${previousText}${currentText}`;
    const mergedHtml = plainTextToHtml(mergedPlain);

    nodes.set(previousEdge.childId, {
      ...previousNode,
      html: mergedHtml,
      updatedAt: command.timestamp
    });

    const previousTextNode = this.ensureNodeText(collections, previousEdge.childId);
    previousTextNode.delete(0, previousTextNode.length);
    if (mergedPlain.length > 0) {
      previousTextNode.insert(0, mergedPlain);
    }

    const currentTextNode = nodeTexts.get(location.edge.childId);
    if (currentTextNode) {
      nodeTexts.delete(location.edge.childId);
    }

    const childEdges = edges.get(location.edge.childId);
    if (childEdges && childEdges.length > 0) {
      const previousChildArray = this.ensureEdgeArray(collections, previousEdge.childId);
      const offset = previousChildArray.length;
      const moved = childEdges.toArray().map((childEdge, index) => ({
        ...childEdge,
        parentId: previousEdge.childId,
        ordinal: offset + index,
        updatedAt: command.timestamp
      }));
      previousChildArray.insert(offset, moved);
      edges.delete(location.edge.childId);
    }

    this.removeEdgeAt(collections, location.parentId, location.index, command.timestamp);
    nodes.delete(location.edge.childId);
  }

  private applyDeleteEdges(
    collections: ReturnType<typeof initializeCollections>,
    command: Command & {kind: 'delete-edges'}
  ): void {
    const unique = Array.from(new Set(command.edgeIds));
    unique.forEach((edgeId) => {
      const location = this.findEdgeLocation(collections, edgeId);
      if (!location) {
        return;
      }
      this.applyDeleteNode(collections, {
        kind: 'delete-node',
        nodeId: location.edge.childId,
        timestamp: command.timestamp
      });
    });
  }

  private ensureEdgeArray(
    collections: ReturnType<typeof initializeCollections>,
    parentId: NodeId
  ): Y.Array<EdgeRecord> {
    const existing = collections.edges.get(parentId);
    if (existing) {
      return existing;
    }

    const array = new Y.Array<EdgeRecord>();
    collections.edges.set(parentId, array);
    return array;
  }

  private insertEdge(
    collections: ReturnType<typeof initializeCollections>,
    parentId: NodeId,
    edge: EdgeRecord
  ): void {
    const edgeArray = this.ensureEdgeArray(collections, parentId);
    const insertIndex = clampIndex(edge.ordinal, 0, edgeArray.length);
    const edgeToInsert: EdgeRecord = {
      ...edge,
      parentId,
      ordinal: insertIndex
    };

    edgeArray.insert(insertIndex, [edgeToInsert]);
    this.normalizeEdgeArray(collections, parentId, edgeArray, edge.updatedAt);
  }

  private removeEdgeAt(
    collections: ReturnType<typeof initializeCollections>,
    parentId: NodeId,
    index: number,
    timestamp: IsoTimestamp
  ): void {
    const edgeArray = collections.edges.get(parentId);
    if (!edgeArray) {
      return;
    }

    edgeArray.delete(index, 1);
    if (edgeArray.length === 0) {
      collections.edges.delete(parentId);
      return;
    }

    this.normalizeEdgeArray(collections, parentId, edgeArray, timestamp);
  }

  private normalizeEdgeArray(
    collections: ReturnType<typeof initializeCollections>,
    parentId: NodeId,
    edgeArray: Y.Array<EdgeRecord>,
    timestamp: IsoTimestamp
  ): void {
    const raw = edgeArray.toArray();
    const selectedEdges = this.getSelectedEdgeIdSet(collections);
    const normalized = raw.map((edge, ordinal) => {
      const isSelected = selectedEdges.has(edge.id);
      if (edge.ordinal === ordinal && edge.parentId === parentId && edge.selected === isSelected) {
        return edge;
      }
      return {
        ...edge,
        parentId,
        ordinal,
        selected: isSelected,
        updatedAt: timestamp
      };
    });

    edgeArray.delete(0, edgeArray.length);

    if (normalized.length === 0) {
      collections.edges.delete(parentId);
      return;
    }

    edgeArray.insert(0, normalized);
  }

  private deleteSubtree(
    collections: ReturnType<typeof initializeCollections>,
    nodeId: NodeId,
    timestamp: IsoTimestamp
  ): void {
    const queue: NodeId[] = [nodeId];

    while (queue.length > 0) {
      const current = queue.pop() as NodeId;
      const childEdges = collections.edges.get(current);
      if (childEdges) {
        const children = childEdges.toArray();
        collections.edges.delete(current);
        children.forEach((edge) => {
          this.detachFromParents(collections, edge.childId, timestamp);
          queue.push(edge.childId);
        });
      }

      collections.nodes.delete(current);
      collections.nodeTexts.delete(current);
    }
  }

  private detachFromParents(
    collections: ReturnType<typeof initializeCollections>,
    targetId: NodeId,
    timestamp: IsoTimestamp
  ): void {
    const parents = Array.from(collections.edges.keys());
    const selectedEdges = this.getSelectedEdgeIdSet(collections);
    for (const parentKey of parents) {
      const parentId: NodeId = parentKey;
      const edgeArray = collections.edges.get(parentId);
      if (!edgeArray) {
        continue;
      }

      const retained = edgeArray.toArray().filter((edge) => edge.childId !== targetId);
      if (retained.length === edgeArray.length) {
        continue;
      }

      if (retained.length === 0) {
        collections.edges.delete(parentId);
        continue;
      }

      edgeArray.delete(0, edgeArray.length);
      const normalized = retained.map((edge, ordinal) => ({
        ...edge,
        parentId,
        ordinal,
        selected: selectedEdges.has(edge.id),
        updatedAt: timestamp
      }));
      edgeArray.insert(0, normalized);
    }
  }

  private findEdgeLocation(
    collections: ReturnType<typeof initializeCollections>,
    edgeId: EdgeId
  ): EdgeLocation | undefined {
    let result: EdgeLocation | undefined;

    collections.edges.forEach((edgeArray, parentKey) => {
      if (result) {
        return;
      }

      const values = edgeArray.toArray();
      const index = values.findIndex((edge) => edge.id === edgeId);
      if (index !== -1) {
        const parentId: NodeId = parentKey;
        result = {
          parentId,
          index,
          edge: values[index],
          array: edgeArray
        };
      }
    });

    return result;
  }

  private findParentEdgeLocation(
    collections: ReturnType<typeof initializeCollections>,
    childId: NodeId
  ): EdgeLocation | undefined {
    let result: EdgeLocation | undefined;

    collections.edges.forEach((edgeArray, parentKey) => {
      if (result) {
        return;
      }

      const values = edgeArray.toArray();
      const index = values.findIndex((edge) => edge.childId === childId);
      if (index !== -1) {
        const parentId: NodeId = parentKey;
        result = {
          parentId,
          index,
          edge: values[index],
          array: edgeArray
        };
      }
    });

    return result;
  }

  private ensureNodeText(
    collections: ReturnType<typeof initializeCollections>,
    nodeId: NodeId
  ): Y.Text {
    let text = collections.nodeTexts.get(nodeId);
    if (!text) {
      text = new Y.Text();
      collections.nodeTexts.set(nodeId, text);
    }
    return text;
  }

  private getSelectedEdgeIdSet(
    collections: ReturnType<typeof initializeCollections>
  ): ReadonlySet<EdgeId> {
    const raw = collections.selectionMeta.get('selectedIds');
    if (typeof raw !== 'string') {
      return new Set();
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((value): value is EdgeId => typeof value === 'string'));
      }
    } catch (error) {
      // Ignore malformed payloads and treat as no selection.
    }
    return new Set();
  }

  private isEdgeSelected(
    collections: ReturnType<typeof initializeCollections>,
    edgeId: EdgeId
  ): boolean {
    const selected = this.getSelectedEdgeIdSet(collections);
    return selected.has(edgeId);
  }
}
