/**
 * RichNodeEditor
 *
 * Responsibility: Host a rich-text adapter instance for a single node and
 * persist changes through the CommandBus/Yjs path. This component does not
 * perform DOM surgery itself; all editing happens within the adapter and all
 * mutations are routed via CommandBus to preserve unified history.
 */
import {useCallback, useEffect, useMemo, useRef} from 'react';

import type {EdgeRecord, NodeId} from '../types';
import {useCommandBus} from '../hooks/commandBusContext';
import {useYDoc} from '../hooks/yDocContext';
import {initializeCollections} from '../yjs/doc';
import {useDocVersion} from '../hooks/useDocVersion';
import type {IRichTextAdapter} from '../richtext';
import {createWebLexicalAdapter} from '../richtext';
import {createEdgeId, createNodeId} from '../ids';
import {renderTextWithWikiLinks} from '../wiki/render';

interface RichNodeEditorProps {
  readonly nodeId: NodeId;
  readonly edge?: EdgeRecord | null;
  readonly className?: string;
  /** Optional typography class to ensure parity with read-only HTML. */
  readonly typographyClassName?: string;
  /** Optional link click handler for in-editor wiki links. */
  readonly onLinkClick?: (targetNodeId: NodeId) => void;
  /** Optional focus directive using viewport coordinates. */
  readonly focusAt?: {x: number; y: number; requestId: number} | null;
  readonly onNodeCreated?: (details: {nodeId: NodeId; edgeId: string}) => void;
  /** Optional selection directive using plain-text offset. */
  readonly selectAt?: {offset: number; requestId: number} | null;
  readonly onSelectDirectiveComplete?: (requestId: number) => void;
  readonly onBackspaceAtStart?: (edge: EdgeRecord) => boolean;
}

const timestamp = () => new Date().toISOString();

export const RichNodeEditor = ({nodeId, edge, className, typographyClassName, onLinkClick, focusAt, onNodeCreated, selectAt, onSelectDirectiveComplete, onBackspaceAtStart}: RichNodeEditorProps) => {
  const bus = useCommandBus();
  const doc = useYDoc();
  const version = useDocVersion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<IRichTextAdapter | null>(null);
  const lastCommittedHtmlRef = useRef<string | null>(null);
  const lastFocusRequestRef = useRef<number | null>(null);
  const containerKeyListenerRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  const lastSelectRequestRef = useRef<number | null>(null);

  const nodeHtml = useMemo(() => {
    const {nodes} = initializeCollections(doc);
    return nodes.get(nodeId)?.html ?? '';
  }, [doc, nodeId, version]);

  const upsertHtml = useCallback((html: string) => {
    if (lastCommittedHtmlRef.current === html) {
      return;
    }
    lastCommittedHtmlRef.current = html;
    bus.execute({
      kind: 'update-node',
      nodeId,
      patch: {html, updatedAt: timestamp()}
    });
  }, [bus, nodeId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    // Create adapter instance (Lexical placeholder for now).
    const adapter = createWebLexicalAdapter();
    adapterRef.current = adapter;

    const unmount = adapter.mount(container, {
      initialHtml: nodeHtml,
      typographyClassName,
      onLinkClick
    });

    const unsubscribe = adapter.onChange((html) => {
      upsertHtml(html);
    });

    // Key handling: minimal Enter behavior to create a new node / split
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) {
        // Handle Backspace at start
        if (
          e.key === 'Backspace' &&
          !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey &&
          edge
        ) {
          const caret = adapter.getSelectionOffset();
          if (caret === 0) {
            const handled = onBackspaceAtStart?.(edge) ?? false;
            if (handled) {
              e.preventDefault();
              return;
            }
          }
        }
        return;
      }
      e.preventDefault();
      if (!edge) return;

      const plain = adapter.getPlainText();
      const caret = Math.max(0, Math.min(adapter.getSelectionOffset(), plain.length));
      const atStart = caret === 0;
      const atEnd = caret === plain.length;

      const {edges} = initializeCollections(doc);
      const childArray = edges.get(nodeId);
      const hasChildren = !!childArray && childArray.length > 0;
      const hasVisibleChildren = hasChildren && !edge.collapsed;

      const now = timestamp();

      // Case 1: caret at end, open parent -> create first child
      if (atEnd && hasVisibleChildren) {
        const newNodeId = createNodeId();
        const newEdgeId = createEdgeId();
        bus.execute({
          kind: 'create-node',
          node: {
            id: newNodeId,
            html: '',
            tags: [],
            attributes: {},
            createdAt: now,
            updatedAt: now
          },
          edge: {
            id: newEdgeId,
            parentId: nodeId,
            childId: newNodeId,
            role: 'primary',
            collapsed: false,
            ordinal: 0,
            selected: false,
            createdAt: now,
            updatedAt: now
          },
          initialText: ''
        });
        onNodeCreated?.({nodeId: newNodeId, edgeId: newEdgeId});
        return;
      }

      // Case 3: caret at start
      if (atStart) {
        if (plain.length === 0) {
          // Treat as end-of-node behavior
          if (hasVisibleChildren) {
            const newNodeId = createNodeId();
            const newEdgeId = createEdgeId();
            bus.execute({
              kind: 'create-node',
              node: {id: newNodeId, html: '', tags: [], attributes: {}, createdAt: now, updatedAt: now},
              edge: {
                id: newEdgeId,
                parentId: nodeId,
                childId: newNodeId,
                role: 'primary',
                collapsed: false,
                ordinal: 0,
                selected: false,
                createdAt: now,
                updatedAt: now
              },
              initialText: ''
            });
            onNodeCreated?.({nodeId: newNodeId, edgeId: newEdgeId});
            return;
          }
          const newNodeId = createNodeId();
          const newEdgeId = createEdgeId();
          bus.execute({
            kind: 'create-node',
            node: {id: newNodeId, html: '', tags: [], attributes: {}, createdAt: now, updatedAt: now},
            edge: {
              id: newEdgeId,
              parentId: edge.parentId,
              childId: newNodeId,
              role: 'primary',
              collapsed: false,
              ordinal: edge.ordinal + 1,
              selected: false,
              createdAt: now,
              updatedAt: now
            },
            initialText: ''
          });
          onNodeCreated?.({nodeId: newNodeId, edgeId: newEdgeId});
          return;
        }
        const newNodeId = createNodeId();
        const newEdgeId = createEdgeId();
        bus.execute({
          kind: 'create-node',
          node: {
            id: newNodeId,
            html: '',
            tags: [],
            attributes: {},
            createdAt: now,
            updatedAt: now
          },
          edge: {
            id: newEdgeId,
            parentId: edge.parentId,
            childId: newNodeId,
            role: 'primary',
            collapsed: false,
            ordinal: edge.ordinal,
            selected: false,
            createdAt: now,
            updatedAt: now
          },
          initialText: ''
        });
        onNodeCreated?.({nodeId: newNodeId, edgeId: newEdgeId});
        return;
      }

      // Case 2: caret at end & (no children or collapsed) -> sibling below
      if (atEnd) {
        const newNodeId = createNodeId();
        const newEdgeId = createEdgeId();
        bus.execute({
          kind: 'create-node',
          node: {
            id: newNodeId,
            html: '',
            tags: [],
            attributes: {},
            createdAt: now,
            updatedAt: now
          },
          edge: {
            id: newEdgeId,
            parentId: edge.parentId,
            childId: newNodeId,
            role: 'primary',
            collapsed: false,
            ordinal: edge.ordinal + 1,
            selected: false,
            createdAt: now,
            updatedAt: now
          },
          initialText: ''
        });
        onNodeCreated?.({nodeId: newNodeId, edgeId: newEdgeId});
        return;
      }

      // Case 4: caret in middle -> split, sibling below with 'after'
      const before = plain.slice(0, caret);
      const after = plain.slice(caret);
      const currentHtml = renderTextWithWikiLinks(before, {resolveTarget: () => null, className: 'thq-wikilink'}).html;
      upsertHtml(currentHtml);

      const newNodeId = createNodeId();
      const newEdgeId = createEdgeId();
      const newHtml = renderTextWithWikiLinks(after, {resolveTarget: () => null, className: 'thq-wikilink'}).html;
      bus.execute({
        kind: 'create-node',
        node: {
          id: newNodeId,
          html: newHtml,
          tags: [],
          attributes: {},
          createdAt: now,
          updatedAt: now
        },
        edge: {
          id: newEdgeId,
          parentId: edge.parentId,
          childId: newNodeId,
          role: 'primary',
          collapsed: false,
          ordinal: edge.ordinal + 1,
          selected: false,
          createdAt: now,
          updatedAt: now
        },
        initialText: after
      });
      onNodeCreated?.({nodeId: newNodeId, edgeId: newEdgeId});
    };
    const bound = keyHandler as (e: Event) => void;
    container.addEventListener('keydown', bound as EventListener);
    containerKeyListenerRef.current = keyHandler;

    return () => {
      unsubscribe();
      unmount();
      adapter.destroy();
      adapterRef.current = null;
      if (containerKeyListenerRef.current) {
        container.removeEventListener('keydown', containerKeyListenerRef.current as unknown as EventListener);
        containerKeyListenerRef.current = null;
      }
    };
  }, []);

  // Sync external HTML changes into the adapter without clobbering local edits.
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    const current = adapter.getHtml();
    if (current !== nodeHtml) {
      adapter.setHtml(nodeHtml);
    }
  }, [nodeHtml]);

  // Apply focus directive when provided
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !focusAt) return;
    if (lastFocusRequestRef.current === focusAt.requestId) return;
    lastFocusRequestRef.current = focusAt.requestId;
    // Defer to next frame to ensure mount/paint complete
    requestAnimationFrame(() => {
      const a = adapterRef.current;
      if (a && lastFocusRequestRef.current === focusAt.requestId) {
        a.focusAt({x: focusAt.x, y: focusAt.y});
      }
    });
  }, [focusAt]);

  // Apply selection directive when provided (focus + caret at offset)
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !selectAt) return;
    if (lastSelectRequestRef.current === selectAt.requestId) return;
    lastSelectRequestRef.current = selectAt.requestId;
    requestAnimationFrame(() => {
      const a = adapterRef.current;
      if (a && lastSelectRequestRef.current === selectAt.requestId) {
        a.setSelection(Math.max(0, selectAt.offset));
        onSelectDirectiveComplete?.(selectAt.requestId);
      }
    });
  }, [onSelectDirectiveComplete, selectAt]);

  return (
    <div
      className={className}
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '1em'
      }}
    />
  );
};
