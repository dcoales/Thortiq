/**
 * Node lifecycle helpers covering creation, text updates, and metadata maintenance. These
 * utilities always run inside transactions and keep Yjs structures encapsulated so callers operate
 * on plain data snapshots.
 */
import * as Y from "yjs";

import { createNodeId, type NodeId } from "../ids";
import type {
  CreateNodeOptions,
  InlineSpan,
  InlineMark,
  NodeMetadata,
  NodeSnapshot,
  OutlineDoc,
  OutlineNodeRecord
} from "../types";
import { NODE_METADATA_KEY, NODE_TEXT_XML_KEY } from "./constants";
import { OutlineError, withTransaction } from "./transactions";

export const createNode = (outline: OutlineDoc, options: CreateNodeOptions = {}): NodeId => {
  const nodeId = options.id ?? createNodeId();

  withTransaction(
    outline,
    () => {
      if (outline.nodes.has(nodeId)) {
        throw new OutlineError(`Node ${nodeId} already exists`);
      }

      const nodeRecord = new Y.Map<unknown>();
      const textFragment = createXmlFragment();
      nodeRecord.set(NODE_TEXT_XML_KEY, textFragment);

      const metadata = createMetadataMap(options.metadata);
      nodeRecord.set(NODE_METADATA_KEY, metadata);

      outline.nodes.set(nodeId, nodeRecord);

      replaceFragmentText(textFragment, options.text ?? "");
    },
    options.origin
  );

  return nodeId;
};

export const nodeExists = (outline: OutlineDoc, nodeId: NodeId): boolean => outline.nodes.has(nodeId);

export const getNodeText = (outline: OutlineDoc, nodeId: NodeId): string => {
  const fragment = getNodeTextFragment(outline, nodeId);
  return xmlFragmentToPlainText(fragment);
};

export const setNodeText = (
  outline: OutlineDoc,
  nodeId: NodeId,
  textValue: string,
  origin?: unknown
): void => {
  withTransaction(outline, () => {
    const fragment = getNodeTextFragment(outline, nodeId);
    replaceFragmentText(fragment, textValue);

    const metadata = getNodeMetadataMap(outline, nodeId);
    metadata.set("updatedAt", Date.now());
  }, origin);
};

export const getNodeMetadata = (outline: OutlineDoc, nodeId: NodeId): NodeMetadata => {
  const metadata = getNodeMetadataMap(outline, nodeId);
  return readMetadata(metadata);
};

export const updateNodeMetadata = (
  outline: OutlineDoc,
  nodeId: NodeId,
  patch: Partial<NodeMetadata>,
  origin?: unknown
): void => {
  withTransaction(outline, () => {
    const metadataMap = getNodeMetadataMap(outline, nodeId);
    applyMetadataPatch(metadataMap, patch);
  }, origin);
};

export const getNodeSnapshot = (outline: OutlineDoc, nodeId: NodeId): NodeSnapshot => {
  const record = outline.nodes.get(nodeId);
  if (!record) {
    throw new OutlineError(`Node ${nodeId} not found`);
  }

  return readNodeSnapshot(nodeId, record);
};

export const getNodeTextFragment = (outline: OutlineDoc, nodeId: NodeId): Y.XmlFragment => {
  const record = getNodeRecord(outline, nodeId);
  const text = record.get(NODE_TEXT_XML_KEY);
  if (!(text instanceof Y.XmlFragment)) {
    throw new OutlineError(`Node ${nodeId} has no text fragment`);
  }
  if (text.length === 0) {
    replaceFragmentText(text, "");
  }
  return text;
};

export interface TodoDoneUpdate {
  readonly nodeId: NodeId;
  readonly done: boolean;
}

export const updateTodoDoneStates = (
  outline: OutlineDoc,
  updates: ReadonlyArray<TodoDoneUpdate>,
  origin?: unknown
): void => {
  if (updates.length === 0) {
    return;
  }

  withTransaction(
    outline,
    () => {
      const timestamp = Date.now();
      for (const update of updates) {
        const metadataMap = getNodeMetadataMap(outline, update.nodeId);
        const todoMap = ensureTodoMap(metadataMap);
        todoMap.set("done", update.done);
        metadataMap.set("updatedAt", timestamp);
      }
    },
    origin
  );
};

export const readNodeSnapshot = (nodeId: NodeId, record: OutlineNodeRecord): NodeSnapshot => {
  const fragment = record.get(NODE_TEXT_XML_KEY);
  const metadata = record.get(NODE_METADATA_KEY);
  const inlineContent = fragment instanceof Y.XmlFragment ? extractInlineContent(fragment) : [];
  const resolvedText = inlineSpansToPlainText(inlineContent);
  const resolvedMetadata = metadata instanceof Y.Map ? readMetadata(metadata) : createEmptyMetadata();

  return {
    id: nodeId,
    text: resolvedText,
    inlineContent,
    metadata: resolvedMetadata
  };
};

const getNodeRecord = (outline: OutlineDoc, nodeId: NodeId): OutlineNodeRecord => {
  const record = outline.nodes.get(nodeId);
  if (!record) {
    throw new OutlineError(`Node ${nodeId} not found`);
  }
  return record;
};

const getNodeMetadataMap = (outline: OutlineDoc, nodeId: NodeId): Y.Map<unknown> => {
  const record = getNodeRecord(outline, nodeId);
  const metadata = record.get(NODE_METADATA_KEY);
  if (!(metadata instanceof Y.Map)) {
    throw new OutlineError(`Node ${nodeId} has no metadata map`);
  }
  return metadata as Y.Map<unknown>;
};

const createMetadataMap = (metadata?: Partial<NodeMetadata>): Y.Map<unknown> => {
  const map = new Y.Map<unknown>();
  const createdAt = metadata?.createdAt ?? Date.now();
  map.set("createdAt", createdAt);
  map.set("updatedAt", metadata?.updatedAt ?? createdAt);

  const tagsArray = new Y.Array<string>();
  const tags = metadata?.tags ?? [];
  if (tags.length > 0) {
    tagsArray.push([...tags]);
  }
  map.set("tags", tagsArray);

  if (metadata?.todo) {
    map.set("todo", createTodoMap(metadata.todo));
  }

  if (metadata?.color) {
    map.set("color", metadata.color);
  }

  if (metadata?.backgroundColor) {
    map.set("backgroundColor", metadata.backgroundColor);
  }

  return map;
};

const createTodoMap = (todo: NonNullable<NodeMetadata["todo"]>): Y.Map<unknown> => {
  const todoMap = new Y.Map<unknown>();
  todoMap.set("done", todo.done);
  if (todo.dueDate) {
    todoMap.set("dueDate", todo.dueDate);
  }
  return todoMap;
};

const readMetadata = (metadata: Y.Map<unknown>): NodeMetadata => {
  const createdAt = metadata.get("createdAt");
  const updatedAt = metadata.get("updatedAt");
  const tagsArray = metadata.get("tags");
  const todo = metadata.get("todo");

  return {
    createdAt: typeof createdAt === "number" ? createdAt : 0,
    updatedAt: typeof updatedAt === "number" ? updatedAt : 0,
    tags: tagsArray instanceof Y.Array ? tagsArray.toArray() : [],
    todo: todo instanceof Y.Map ? readTodoMetadata(todo) : undefined,
    color: typeof metadata.get("color") === "string" ? (metadata.get("color") as string) : undefined,
    backgroundColor:
      typeof metadata.get("backgroundColor") === "string"
        ? (metadata.get("backgroundColor") as string)
        : undefined
  };
};

const readTodoMetadata = (todoMap: Y.Map<unknown>): NonNullable<NodeMetadata["todo"]> => {
  const done = Boolean(todoMap.get("done"));
  const dueDate = todoMap.get("dueDate");
  return { done, dueDate: typeof dueDate === "string" ? dueDate : undefined };
};

const applyMetadataPatch = (metadataMap: Y.Map<unknown>, patch: Partial<NodeMetadata>): void => {
  const now = Date.now();
  if (patch.tags) {
    const tagsArray = ensureTagsArray(metadataMap);
    tagsArray.delete(0, tagsArray.length);
    if (patch.tags.length > 0) {
      tagsArray.push(Array.from(patch.tags));
    }
  }

  if (patch.todo) {
    const todo = metadataMap.get("todo");
    if (todo instanceof Y.Map) {
      todo.set("done", patch.todo.done);
      if (patch.todo.dueDate) {
        todo.set("dueDate", patch.todo.dueDate);
      } else {
        todo.delete("dueDate");
      }
    } else {
      metadataMap.set("todo", createTodoMap(patch.todo));
    }
  } else if (hasOwnProperty(patch, "todo")) {
    metadataMap.delete("todo");
  }

  if (hasOwnProperty(patch, "color")) {
    if (patch.color == null) {
      metadataMap.delete("color");
    } else {
      metadataMap.set("color", patch.color);
    }
  }

  if (hasOwnProperty(patch, "backgroundColor")) {
    if (patch.backgroundColor == null) {
      metadataMap.delete("backgroundColor");
    } else {
      metadataMap.set("backgroundColor", patch.backgroundColor);
    }
  }

  metadataMap.set("updatedAt", patch.updatedAt ?? now);
};

const ensureTagsArray = (metadataMap: Y.Map<unknown>): Y.Array<string> => {
  const tags = metadataMap.get("tags");
  if (tags instanceof Y.Array) {
    return tags as Y.Array<string>;
  }
  const newArray = new Y.Array<string>();
  metadataMap.set("tags", newArray);
  return newArray;
};

const ensureTodoMap = (metadataMap: Y.Map<unknown>): Y.Map<unknown> => {
  const existing = metadataMap.get("todo");
  if (existing instanceof Y.Map) {
    return existing;
  }
  const todoMap = new Y.Map<unknown>();
  metadataMap.set("todo", todoMap);
  return todoMap;
};

const createXmlFragment = (): Y.XmlFragment => new Y.XmlFragment();

const replaceFragmentText = (fragment: Y.XmlFragment, text: string): void => {
  fragment.delete(0, fragment.length);
  const paragraph = new Y.XmlElement("paragraph");
  if (text.length > 0) {
    const textNode = new Y.XmlText();
    textNode.insert(0, text);
    paragraph.insert(0, [textNode]);
  }
  fragment.insert(0, [paragraph]);
};

interface MutableInlineSpan {
  text: string;
  marks: InlineMark[];
  markKeys: readonly string[];
}

const MARK_NAME_HASH_PATTERN = /(.*)(--[A-Za-z0-9+/=]{8})$/u;

const extractInlineContent = (fragment: Y.XmlFragment): ReadonlyArray<InlineSpan> => {
  const spans: MutableInlineSpan[] = [];

  const appendSegment = (text: string, marks: InlineMark[]): void => {
    if (text.length === 0) {
      return;
    }
    const sortedMarks = sortMarks(marks);
    const markKeys = sortedMarks.map(createMarkKey);
    const previous = spans[spans.length - 1];
    if (previous && markKeysEqual(previous.markKeys, markKeys)) {
      previous.text += text;
      return;
    }
    spans.push({
      text,
      marks: sortedMarks,
      markKeys
    });
  };

  const visitNode = (node: Y.XmlElement | Y.XmlText | unknown): void => {
    if (node instanceof Y.XmlText) {
      const deltas = node.toDelta() as Array<{
        insert: unknown;
        attributes?: Record<string, unknown>;
      }>;
      for (const delta of deltas) {
        if (typeof delta.insert !== "string") {
          continue;
        }
        const marks = decodeMarks(delta.attributes);
        appendSegment(delta.insert, marks);
      }
      return;
    }
    if (node instanceof Y.XmlElement) {
      const children = node.toArray();
      for (const child of children) {
        visitNode(child);
      }
    }
  };

  const children = fragment.toArray();
  children.forEach((child, index) => {
    if (index > 0) {
      appendSegment("\n", []);
    }
    visitNode(child);
  });

  trimTrailingNewlines(spans);

  return spans.map(({ text, marks }) => ({
    text,
    marks: marks as ReadonlyArray<InlineMark>
  }));
};

const inlineSpansToPlainText = (spans: ReadonlyArray<InlineSpan>): string => {
  if (spans.length === 0) {
    return "";
  }
  return spans.map((span) => span.text).join("");
};

interface InlineSegmentDescriptor {
  readonly text: string;
  readonly marks: InlineMark[];
  readonly textNode: Y.XmlText | null;
  readonly rawAttributes?: Record<string, unknown>;
  readonly globalStart: number;
  readonly relativeStart: number | null;
}

const collectInlineSegmentDescriptors = (
  fragment: Y.XmlFragment
): InlineSegmentDescriptor[] => {
  const segments: InlineSegmentDescriptor[] = [];
  let globalOffset = 0;

  const appendSegment = (
    text: string,
    marks: InlineMark[],
    textNode: Y.XmlText | null,
    rawAttributes: Record<string, unknown> | undefined,
    relativeStart: number | null
  ) => {
    segments.push({
      text,
      marks,
      textNode,
      rawAttributes,
      globalStart: globalOffset,
      relativeStart
    });
    globalOffset += text.length;
  };

  const visitNode = (node: Y.XmlElement | Y.XmlText | unknown) => {
    if (node instanceof Y.XmlText) {
      const deltas = node.toDelta() as Array<{
        insert: unknown;
        attributes?: Record<string, unknown>;
      }>;
      let relativeOffset = 0;
      for (const delta of deltas) {
        if (typeof delta.insert !== "string") {
          continue;
        }
        const rawAttributes = delta.attributes ? { ...delta.attributes } : undefined;
        const marks = decodeMarks(rawAttributes);
        const text = delta.insert;
        appendSegment(text, marks, node, rawAttributes, relativeOffset);
        relativeOffset += text.length;
      }
      return;
    }
    if (node instanceof Y.XmlElement) {
      const children = node.toArray();
      children.forEach((child) => {
        visitNode(child);
      });
      return;
    }
  };

  const children = fragment.toArray();
  children.forEach((child, index) => {
    visitNode(child);
    if (index < children.length - 1) {
      appendSegment("\n", [], null, undefined, null);
    }
  });

  return segments;
};

export const updateWikiLinkDisplayText = (
  outline: OutlineDoc,
  nodeId: NodeId,
  segmentIndex: number,
  newText: string,
  origin?: unknown
): void => {
  if (segmentIndex < 0) {
    return;
  }

  withTransaction(
    outline,
    () => {
      const fragment = getNodeTextFragment(outline, nodeId);
      const segments = collectInlineSegmentDescriptors(fragment);
      const segment = segments[segmentIndex];
      if (!segment || !segment.textNode || segment.relativeStart == null) {
        return;
      }
      const replacement = newText ?? "";
      if (segment.text === replacement) {
        return;
      }
      const textNode = segment.textNode;
      textNode.delete(segment.relativeStart, segment.text.length);
      textNode.insert(segment.relativeStart, replacement, segment.rawAttributes);

      const metadataMap = getNodeMetadataMap(outline, nodeId);
      metadataMap.set("updatedAt", Date.now());
    },
    origin
  );
};

const decodeMarks = (attributes?: Record<string, unknown>): InlineMark[] => {
  if (!attributes) {
    return [];
  }
  const marks: InlineMark[] = [];
  for (const rawKey of Object.keys(attributes)) {
    const value = attributes[rawKey];
    const type = normaliseMarkName(rawKey);
    const attrs = cloneAttributeRecord(value);
    marks.push({ type, attrs });
  }
  return marks;
};

const normaliseMarkName = (rawName: string): string => {
  const match = MARK_NAME_HASH_PATTERN.exec(rawName);
  if (!match) {
    return rawName;
  }
  return match[1];
};

const cloneAttributeRecord = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!value || typeof value !== "object") {
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    result[key] = entryValue;
  }
  return result as Readonly<Record<string, unknown>>;
};

const sortMarks = (marks: InlineMark[]): InlineMark[] => {
  if (marks.length <= 1) {
    return marks.slice();
  }
  return [...marks].sort((left, right) => {
    const leftKey = createMarkKey(left);
    const rightKey = createMarkKey(right);
    return leftKey.localeCompare(rightKey);
  });
};

const createMarkKey = (mark: InlineMark): string => {
  return `${mark.type}:${JSON.stringify(mark.attrs)}`;
};

const markKeysEqual = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((key, index) => key === right[index]);
};

const trimTrailingNewlines = (spans: MutableInlineSpan[]): void => {
  while (spans.length > 0) {
    const last = spans[spans.length - 1];
    if (last.markKeys.length > 0) {
      return;
    }
    const trimmed = last.text.replace(/\n+$/u, "");
    if (trimmed.length === 0) {
      spans.pop();
      continue;
    }
    last.text = trimmed;
    return;
  }
};

const xmlFragmentToPlainText = (fragment: Y.XmlFragment): string => {
  return inlineSpansToPlainText(extractInlineContent(fragment));
};

const hasOwnProperty = (value: object, key: string): boolean => {
  return Object.prototype.hasOwnProperty.call(value, key);
};

const createEmptyMetadata = (): NodeMetadata => ({
  createdAt: 0,
  updatedAt: 0,
  tags: []
});
