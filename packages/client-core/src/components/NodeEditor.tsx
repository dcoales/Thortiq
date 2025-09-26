/**
 * NodeEditor
 *
 * Responsibility: Inline text editing for a single node while delegating
 * structural mutations and metadata persistence to the shared CommandBus/Yjs
 * helpers. Keeps cursor stable by avoiding DOM surgery during typing.
 *
 * Key flows:
 * - Text state is sourced from Yjs (useNodeText) and updates occur inside
 *   Y.Doc transactions with LOCAL_ORIGIN so UndoManager captures local edits
 *   and ignores remote ones.
 * - Node HTML + timestamps are persisted via the command bus (update-node)
 *   on blur or before structural splits; HTML is derived from the plain text.
 * - Structural actions (create sibling/child, split, indent/outdent) are
 *   executed via CommandBus, ensuring mutations respect mirrors-as-edges and
 *   remain within Yjs transactions managed centrally.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {createPortal} from 'react-dom';
import type { ChangeEvent, KeyboardEvent } from 'react';

import type { EdgeId, EdgeRecord, NodeId, NodeRecord } from '../types';
import { createEdgeId, createNodeId } from '../ids';
import { useNodeText } from '../hooks/useNodeText';
import { useCommandBus } from '../hooks/commandBusContext';
import { useYDoc } from '../hooks/yDocContext';
import { useDocVersion } from '../hooks/useDocVersion';
import { initializeCollections } from '../yjs/doc';
import { renderTextWithWikiLinks } from '../wiki/render';
import { findActiveWikiTrigger } from '../wiki/trigger';
import { findWikiCandidates, type WikiCandidate } from '../wiki/search';
import { WikiLinkMenu } from './wiki/WikiLinkMenu';

interface NodeEditorProps {
  readonly nodeId: NodeId;
  readonly edge: EdgeRecord | null;
  readonly className?: string;
  readonly onNodeCreated?: (details: { nodeId: NodeId; edgeId: EdgeId }) => void;
  readonly onTabCommand?: (
    edge: EdgeRecord | null,
    direction: 'indent' | 'outdent',
    caretPosition: number | null
  ) => boolean;
  readonly onBackspaceAtStart?: (edge: EdgeRecord) => boolean;
  readonly onFocusEdge?: (edgeId: EdgeId | null) => void;
  readonly focusDirective?: { position: number; requestId: number } | null;
  readonly onFocusDirectiveComplete?: (requestId: number) => void;
}

const timestamp = () => new Date().toISOString();

// Render node HTML from plain text, converting wikilinks to styled spans.
// Note: target part uses an id-encoded scheme [[Display|id:<NodeId>]].
// We resolve only id-encoded targets here to avoid heavy full-text scans on every keystroke.
// Other forms remain unresolved until upgraded.
const WIKI_ID_PREFIX = 'id:';

export const NodeEditor = ({
  nodeId,
  edge,
  className,
  onNodeCreated,
  onTabCommand,
  onBackspaceAtStart,
  onFocusEdge,
  focusDirective,
  onFocusDirectiveComplete
}: NodeEditorProps) => {
  const [value, setValue] = useNodeText(nodeId);
  const [composing, setComposing] = useState(false);
  const bus = useCommandBus();
  const doc = useYDoc();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Wikilink state: open flag, trigger range and query, and filtered results
  const [wikiOpen, setWikiOpen] = useState(false);
  const [wikiStart, setWikiStart] = useState<number | null>(null);
  const [wikiQuery, setWikiQuery] = useState('');
  const [wikiActiveIndex, setWikiActiveIndex] = useState(0);
  const [wikiMenuPos, setWikiMenuPos] = useState<{top: number; left: number; position: 'absolute' | 'fixed'}>({top: 0, left: 0, position: 'absolute'});
  const [wikiCandidates, setWikiCandidates] = useState<ReturnType<typeof findWikiCandidates>>([]);

  const version = useDocVersion();

  const node = useMemo(() => {
    const { nodes } = initializeCollections(doc);
    return nodes.get(nodeId) ?? null;
  }, [doc, nodeId, version]);

  if (!node) {
    return null;
  }

  const hasVisibleChildren = useMemo(() => {
    if (!edge) {
      return true;
    }
    const { edges } = initializeCollections(doc);
    const children = edges.get(node.id);
    if (!children || children.length === 0) {
      return false;
    }
    return !edge.collapsed;
  }, [doc, edge, node.id, version]);

  // Resolve [[...|id:<NodeId>]] to clickable spans; unresolved tokens remain styled but inert.
  const sanitizeHtml = useCallback((text: string) => {
    const {nodes} = initializeCollections(doc);
    const resolveTarget = (targetText: string) => {
      const raw = targetText.trim();
      const id = raw.startsWith(WIKI_ID_PREFIX) ? raw.slice(WIKI_ID_PREFIX.length) : '';
      if (id && nodes.has(id)) {
        return id;
      }
      return null;
    };
    return renderTextWithWikiLinks(text, {resolveTarget, className: 'thq-wikilink'}).html;
  }, [doc, version]);

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
      const next = event.target.value;
      setValue(next);

      const caret = event.target.selectionStart ?? next.length;
      const match = findActiveWikiTrigger(next, caret);
      if (match) {
        setWikiOpen(true);
        setWikiStart(match.start);
        setWikiQuery(match.query);
        setWikiActiveIndex(0);
      } else if (wikiOpen) {
        setWikiOpen(false);
        setWikiStart(null);
        setWikiQuery('');
        setWikiActiveIndex(0);
      }
    },
    [setValue, wikiOpen]
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
        selected: false,
        createdAt: now,
        updatedAt: now
      };
      bus.execute({ kind: 'create-node', node: newNode, edge: newEdge, initialText: text });
      onNodeCreated?.({ nodeId: newNode.id, edgeId: newEdge.id });
      return newEdge;
    },
    [bus, createNodeRecord, onNodeCreated]
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

      if (value.length === 0) {
        handleCreateSiblingBelow();
        return;
      }

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
        bus.execute({ kind: 'outdent-node', edgeId: edge.id, timestamp: time });
      } else {
        bus.execute({ kind: 'indent-node', edgeId: edge.id, timestamp: time });
      }
    },
    [bus, edge]
  );

  // Replace active [[... with a resolved wikilink token that embeds the node id.
  const insertWikiChoice = useCallback((chosen: WikiCandidate, textarea: HTMLTextAreaElement) => {
    const caret = textarea.selectionStart ?? value.length;
    const start = wikiStart ?? caret;
    const before = value.slice(0, start - 2);
    const after = value.slice(caret);
    const display = chosen.label;
    // Store target by stable id to satisfy Stable IDs and fast resolution.
    const targetText = `${WIKI_ID_PREFIX}${chosen.nodeId}`;
    const needSpace = after.length === 0 || after[0] !== ' ';
    const insertion = `[[${display}|${targetText}]]${needSpace ? ' ' : ''}`;
    const nextValue = before + insertion + after;
    updateCurrentText(nextValue);
    setWikiOpen(false);
    setWikiStart(null);
    setWikiQuery('');
    setWikiActiveIndex(0);

    const nextCaret = (before + insertion).length;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(nextCaret, nextCaret);
      }
    });
  }, [updateCurrentText, value, wikiStart]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (wikiOpen) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setWikiActiveIndex((current) => {
            const count = wikiCandidates.length;
            if (count === 0) return 0;
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            const next = (current + delta + count) % count;
            return next;
          });
          return;
        }
        if (event.key === 'Enter') {
          const chosen = wikiCandidates[wikiActiveIndex];
          if (chosen) {
            event.preventDefault();
            insertWikiChoice(chosen, event.currentTarget);
          }
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setWikiOpen(false);
          setWikiStart(null);
          setWikiQuery('');
          setWikiActiveIndex(0);
          return;
        }
      }
      if (event.key === 'Enter') {
        handleEnter(event);
        return;
      }

      if (event.key === 'Tab') {
        const caret = event.currentTarget.selectionStart ?? null;
        const handled = onTabCommand?.(edge, event.shiftKey ? 'outdent' : 'indent', caret) ?? false;
        if (handled) {
          event.preventDefault();
          return;
        }
        handleIndent(event);
        return;
      }

      if (
        event.key === 'Backspace' &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        edge
      ) {
        const caret = event.currentTarget.selectionStart;
        if (caret === 0 && event.currentTarget.selectionEnd === 0) {
          const handled = onBackspaceAtStart?.(edge) ?? false;
          if (handled) {
            event.preventDefault();
            return;
          }
        }
      }
    },
    [edge, handleEnter, handleIndent, onBackspaceAtStart, onTabCommand, wikiCandidates.length, wikiOpen, insertWikiChoice]
  );

  const handleCompositionStart = useCallback(() => setComposing(true), []);
  const handleCompositionEnd = useCallback(() => setComposing(false), []);

  const handleFocus = useCallback(() => {
    onFocusEdge?.(edge ? edge.id : null);
  }, [edge, onFocusEdge]);

  const handleBlur = useCallback(() => {
    onFocusEdge?.(null);
    commitHtmlIfChanged(value);
    setWikiOpen(false);
  }, [commitHtmlIfChanged, onFocusEdge, value]);

  // Update candidate list when query/doc changes (debounced via effect)
  useEffect(() => {
    if (!wikiOpen) {
      return;
    }
    const handle = setTimeout(() => {
      const results = findWikiCandidates({doc, query: wikiQuery, excludeNodeIds: new Set([node.id])});
      setWikiCandidates(results);
    }, 100);
    return () => clearTimeout(handle);
  }, [doc, wikiOpen, wikiQuery, node.id]);

  // Position popup near the textarea; ensure it stays within viewport bounds
  useLayoutEffect(() => {
    if (!wikiOpen) return;
    const container = containerRef.current;
    if (!container || typeof window === 'undefined') return;
    const rect = container.getBoundingClientRect();
    const viewportW = window.innerWidth || 0;
    const viewportH = window.innerHeight || 0;
    const menuMaxH = 240; // matches WikiLinkMenu maxHeight
    const menuW = 320; // approximate width (>= minWidth)

    let top = rect.bottom + 4;
    // If bottom overflows, flip above
    if (top + menuMaxH > viewportH - 8) {
      top = Math.max(8, rect.top - menuMaxH - 4);
    }

    let left = rect.left;
    if (left + menuW > viewportW - 8) {
      left = Math.max(8, viewportW - menuW - 8);
    }
    setWikiMenuPos({top, left, position: 'fixed'});
  }, [wikiOpen, value]);

  const pendingDirectiveRef = useRef<{
    requestId: number;
    position: number;
    lastValue: string | null;
    notified: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    if (focusDirective) {
      pendingDirectiveRef.current = {
        requestId: focusDirective.requestId,
        position: focusDirective.position,
        lastValue: null,
        notified: false
      };
    }
  }, [focusDirective]);

  useLayoutEffect(() => {
    const directive = pendingDirectiveRef.current;
    if (!directive) {
      return;
    }

    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const desiredPosition = directive.position < 0
      ? value.length
      : Math.max(0, Math.min(directive.position, value.length));

    const selectionAlreadyCorrect =
      directive.lastValue === value &&
      textarea.selectionStart === desiredPosition &&
      textarea.selectionEnd === desiredPosition &&
      document.activeElement === textarea;

    if (!selectionAlreadyCorrect) {
      textarea.focus();
      textarea.setSelectionRange(desiredPosition, desiredPosition);
      directive.position = desiredPosition;
      directive.lastValue = value;
    }

    if (!directive.notified) {
      directive.notified = true;
      onFocusDirectiveComplete?.(directive.requestId);
      pendingDirectiveRef.current = null;
    }
  }, [onFocusDirectiveComplete, value]);

  return (
    <div ref={containerRef} style={{position: 'relative', flex: 1, minWidth: 0}}>
      <textarea
        ref={textareaRef}
        className={className}
        value={value}
        onChange={handleChange}
        onKeyDown={composing ? undefined : handleKeyDown}
        onBlur={handleBlur}
        onFocus={handleFocus}
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
          font: 'inherit',
          color: '#2c3336',
          width: '100%'
        }}
      />
      {typeof document !== 'undefined' && createPortal(
        <WikiLinkMenu
          open={wikiOpen}
          candidates={wikiCandidates}
          activeIndex={wikiActiveIndex}
          onSelect={(nodeId) => {
            const idx = wikiCandidates.findIndex((c) => c.nodeId === nodeId);
            if (idx >= 0) setWikiActiveIndex(idx);
            const el = textareaRef.current;
            const chosen = wikiCandidates[idx >= 0 ? idx : 0];
          if (el && chosen) {
            insertWikiChoice(chosen, el);
          }
          }}
          onHoverIndex={setWikiActiveIndex}
          style={{top: wikiMenuPos.top, left: wikiMenuPos.left, position: wikiMenuPos.position}}
        />,
        document.body
      )}
    </div>
  );
};



