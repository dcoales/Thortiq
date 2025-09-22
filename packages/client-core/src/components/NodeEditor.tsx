import {useCallback, useMemo, useState} from 'react';
import type {ChangeEvent, KeyboardEvent} from 'react';

import type {EdgeRecord, NodeId, NodeRecord} from '../types';
import {createEdgeId, createNodeId} from '../ids';
import {plainTextToHtml} from '../utils/text';
import {useNodeText} from '../hooks/useNodeText';
import {useCommandBus} from '../hooks/commandBusContext';
import {useYDoc} from '../hooks/yDocContext';
import {useDocVersion} from '../hooks/useDocVersion';
import {initializeCollections} from '../yjs/doc';

interface NodeEditorProps {
  readonly nodeId: NodeId;
  readonly edge: EdgeRecord | null;
  readonly className?: string;
}

const timestamp = () => new Date().toISOString();

const sanitizeHtml = (value: string) => plainTextToHtml(value);

export const NodeEditor = ({nodeId, edge, className}: NodeEditorProps) => {
  const [value, setValue] = useNodeText(nodeId);
  const [composing, setComposing] = useState(false);
  const bus = useCommandBus();
  const doc = useYDoc();

  const version = useDocVersion();

  const node = useMemo(() => {
    const {nodes} = initializeCollections(doc);
    return nodes.get(nodeId) ?? null;
  }, [doc, nodeId, version]);

  if (!node) {
    return null;
  }

  const hasVisibleChildren = useMemo(() => {
    const {edges} = initializeCollections(doc);
    const children = edges.get(node.id);
    if (!children || children.length === 0) {
      return false;
    }
    if (!edge) {
      return true;
    }
    return !edge.collapsed;
  }, [doc, edge, node.id, version]);

  const commitHtmlIfChanged = useCallback(
    (text: string) => {
      const nextHtml = sanitizeHtml(text);
      if (nextHtml === node.html) {
        return;
      }
      bus.execute({
        kind: 'update-node',
        nodeId: node.id,
        patch: {
          html: nextHtml,
          updatedAt: timestamp()
        }
      });
    },
    [bus, node.html, node.id]
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setValue(event.target.value);
    },
    [setValue]
  );

  const createNodeRecord = useCallback(
    (text: string) => {
      const id = createNodeId();
      const now = timestamp();
      const html = sanitizeHtml(text);
      const nextNode: NodeRecord = {
        id,
        html,
        tags: [],
        attributes: {},
        createdAt: now,
        updatedAt: now
      };
      return nextNode;
    },
    []
  );

  const insertNode = useCallback(
    (parent: string, ordinal: number, text: string) => {
      const newNode = createNodeRecord(text);
      const now = timestamp();
      const newEdge: EdgeRecord = {
        id: createEdgeId(),
        parentId: parent,
        childId: newNode.id,
        role: 'primary',
        collapsed: false,
        ordinal,
        createdAt: now,
        updatedAt: now
      };
      bus.execute({kind: 'create-node', node: newNode, edge: newEdge, initialText: text});
      return newNode.id;
    },
    [bus, createNodeRecord]
  );

  const updateCurrentText = useCallback(
    (next: string) => {
      setValue(next);
      commitHtmlIfChanged(next);
    },
    [commitHtmlIfChanged, setValue]
  );

  const handleSplitNode = useCallback(
    (position: number) => {
      const before = value.slice(0, position);
      const after = value.slice(position);
      const currentHtmlChanged = before !== value;
      if (currentHtmlChanged) {
        updateCurrentText(before);
      }

      const ordinal = edge ? edge.ordinal + 1 : 0;
      insertNode(edge?.parentId ?? node.id, ordinal, after);
    },
    [edge, insertNode, node.id, updateCurrentText, value]
  );

  const handleCreateSiblingAbove = useCallback(() => {
    if (!edge) {
      return;
    }
    insertNode(edge.parentId, edge.ordinal, '');
  }, [edge, insertNode]);

  const handleCreateSiblingBelow = useCallback(() => {
    if (edge) {
      insertNode(edge.parentId, edge.ordinal + 1, '');
    } else {
      insertNode(node.id, 0, '');
    }
  }, [edge, insertNode, node.id]);

  const handleCreateChild = useCallback(() => {
    insertNode(node.id, 0, '');
  }, [insertNode, node.id]);

  const handleEnter = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
        return;
      }

      const target = event.currentTarget;
      const caret = target.selectionStart;
      if (caret === undefined) {
        return;
      }

      event.preventDefault();

      if (caret === 0) {
        handleCreateSiblingAbove();
        return;
      }

      if (caret === value.length) {
        if (hasVisibleChildren) {
          handleCreateChild();
        } else {
          handleCreateSiblingBelow();
        }
        return;
      }

      handleSplitNode(caret);
    },
    [handleCreateChild, handleCreateSiblingAbove, handleCreateSiblingBelow, handleSplitNode, hasVisibleChildren, value.length]
  );

  const handleIndent = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!edge) {
        return;
      }
      event.preventDefault();
      const time = timestamp();
      if (event.shiftKey) {
        bus.execute({kind: 'outdent-node', edgeId: edge.id, timestamp: time});
      } else {
        bus.execute({kind: 'indent-node', edgeId: edge.id, timestamp: time});
      }
    },
    [bus, edge]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter') {
        handleEnter(event);
        return;
      }

      if (event.key === 'Tab') {
        handleIndent(event);
      }
    },
    [handleEnter, handleIndent]
  );

  const handleBlur = useCallback(() => {
    commitHtmlIfChanged(value);
  }, [commitHtmlIfChanged, value]);

  const handleCompositionStart = useCallback(() => setComposing(true), []);
  const handleCompositionEnd = useCallback(() => setComposing(false), []);

  return (
    <textarea
      className={className}
      value={value}
      onChange={handleChange}
      onKeyDown={composing ? undefined : handleKeyDown}
      onBlur={handleBlur}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      aria-label={`Node ${node.id}`}
      rows={Math.max(1, value.split('\n').length)}
      style={{
        flex: 1,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        resize: 'none',
        font: 'inherit'
      }}
    />
  );
};
