/**
 * Node lifecycle helpers covering creation, text updates, and metadata maintenance. These
 * utilities always run inside transactions and keep Yjs structures encapsulated so callers operate
 * on plain data snapshots.
 */
import * as Y from "yjs";

import { createNodeId, type NodeId } from "../ids";
import type {
  CreateNodeOptions,
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

  const resolvedText = fragment instanceof Y.XmlFragment ? xmlFragmentToPlainText(fragment) : "";
  const resolvedMetadata = metadata instanceof Y.Map ? readMetadata(metadata) : createEmptyMetadata();

  return {
    id: nodeId,
    text: resolvedText,
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

const xmlFragmentToPlainText = (fragment: Y.XmlFragment): string => {
  const paragraphs = fragment.toArray();
  const lines = paragraphs.map((child) => {
    if (child instanceof Y.XmlText) {
      return child.toString();
    }
    if (child instanceof Y.XmlElement) {
      return xmlElementToText(child);
    }
    return "";
  });

  const text = lines.join("\n");
  return text.replace(/\n+$/, "");
};

const xmlElementToText = (element: Y.XmlElement): string => {
  const parts: string[] = [];
  element.toArray().forEach((child) => {
    if (child instanceof Y.XmlText) {
      parts.push(child.toString());
    } else if (child instanceof Y.XmlElement) {
      parts.push(xmlElementToText(child));
    }
  });
  return parts.join("");
};

const hasOwnProperty = (value: object, key: string): boolean => {
  return Object.prototype.hasOwnProperty.call(value, key);
};

const createEmptyMetadata = (): NodeMetadata => ({
  createdAt: 0,
  updatedAt: 0,
  tags: []
});
