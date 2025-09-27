import {useCallback, useEffect, useMemo, useRef} from 'react';
import type {Node as ProseMirrorNode} from 'prosemirror-model';
import {EditorState, TextSelection, type Transaction, type Command} from 'prosemirror-state';
import {EditorView} from 'prosemirror-view';
import {keymap} from 'prosemirror-keymap';
import {baseKeymap} from 'prosemirror-commands';
import * as Y from 'yjs';

import type {NodeEditorProps} from '../components/NodeEditor';
import {useNodeText} from '../hooks/useNodeText';
import {useCommandBus} from '../hooks/commandBusContext';
import {useYDoc} from '../hooks/yDocContext';
import {useDocVersion} from '../hooks/useDocVersion';
import {
  getOrCreateNodeRichText,
  getOrCreateNodeText,
  initializeCollections
} from '../yjs/doc';
import {ySyncPlugin} from 'y-prosemirror';
import {
  plainTextToRichTextDoc,
  richTextDocToHtml,
  richTextDocToPlainText
} from './serializers';
import {richTextSchema} from './schema';
import {createEdgeId, createNodeId} from '../ids';
import {plainTextToHtml} from '../utils/text';
import type {EdgeRecord, NodeRecord} from '../types';

const timestamp = () => new Date().toISOString();
const COMMIT_DEBOUNCE_MS = 75;
const RICH_TEXT_MIRROR_ORIGIN = Symbol('thortiq.richtext.mirror');

interface PendingCommit {
  readonly html: string;
}

const computeCaretOffset = (state: EditorState): number =>
  state.doc.textBetween(0, state.selection.from, '\n', '\n').length;

/**
 * Feature-flagged ProseMirror-backed editor that mirrors the classic
 * textarea behaviours (Enter/Backspace/Tab) while persisting changes through
 * Yjs and the CommandBus.
 */
export const ProseMirrorNodeEditor = ({
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const stateRef = useRef<EditorState | null>(null);
  const previousNodeIdRef = useRef<string | null>(null);
  const seededTextRef = useRef<string>('');
  const handledDirectiveRef = useRef<number | null>(null);
  const commitTimerRef = useRef<number | null>(null);
  const pendingCommitRef = useRef<PendingCommit | null>(null);

  const doc = useYDoc();
  const bus = useCommandBus();
  const docVersion = useDocVersion();
  const [fallbackText] = useNodeText(nodeId);

  const nodeRecord = useMemo(() => {
    const {nodes} = initializeCollections(doc);
    return nodes.get(nodeId) ?? null;
  }, [doc, nodeId, docVersion]);

  if (!nodeRecord) {
    return null;
  }

  const fragmentRef = useRef<Y.XmlFragment | null>(null);
  if (!fragmentRef.current || previousNodeIdRef.current !== nodeId) {
    fragmentRef.current = getOrCreateNodeRichText(doc, nodeId);
  }
  const fragment = fragmentRef.current;

  const hasVisibleChildren = useMemo(() => {
    if (!edge) {
      return true;
    }
    const {edges} = initializeCollections(doc);
    const children = edges.get(nodeRecord.id);
    if (!children || children.length === 0) {
      return false;
    }
    return !edge.collapsed;
  }, [doc, docVersion, edge, nodeRecord.id]);

  const flushPendingCommit = useCallback(() => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const payload = pendingCommitRef.current;
    if (!payload) {
      return;
    }
    pendingCommitRef.current = null;
    const {nodes} = initializeCollections(doc);
    const currentHtml = nodes.get(nodeId)?.html ?? '';
    if (currentHtml === payload.html) {
      return;
    }
    bus.execute({
      kind: 'update-node',
      nodeId,
      patch: {
        html: payload.html,
        updatedAt: timestamp(),
        richTextSource: 'prosemirror'
      }
    });
  }, [bus, doc, nodeId]);

  const scheduleCommit = useCallback(
    (html: string) => {
      pendingCommitRef.current = {html};
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
      }
      commitTimerRef.current = window.setTimeout(() => {
        commitTimerRef.current = null;
        flushPendingCommit();
      }, COMMIT_DEBOUNCE_MS);
    },
    [flushPendingCommit]
  );

  useEffect(() => () => {
    flushPendingCommit();
  }, [flushPendingCommit]);

  const syncPlainText = useCallback(
    (plain: string) => {
      const textShared = getOrCreateNodeText(doc, nodeId);
      const rawValue = textShared.toJSON();
      const currentValue = typeof rawValue === 'string' ? rawValue : '';
      if (currentValue === plain) {
        return;
      }
      doc.transact(() => {
        textShared.delete(0, textShared.length);
        if (plain.length > 0) {
          textShared.insert(0, plain);
        }
      }, RICH_TEXT_MIRROR_ORIGIN);
    },
    [doc, nodeId]
  );

  const createNodeRecord = useCallback((text: string): NodeRecord => {
    const id = createNodeId();
    const now = timestamp();
    return {
      id,
      html: plainTextToHtml(text),
      tags: [],
      attributes: {},
      createdAt: now,
      updatedAt: now
    };
  }, []);

  const insertNode = useCallback(
    (parentId: string, ordinal: number, text: string): EdgeRecord => {
      const newNode = createNodeRecord(text);
      const now = timestamp();
      const newEdge: EdgeRecord = {
        id: createEdgeId(),
        parentId,
        childId: newNode.id,
        role: 'primary',
        collapsed: false,
        ordinal,
        selected: false,
        createdAt: now,
        updatedAt: now
      };
      bus.execute({kind: 'create-node', node: newNode, edge: newEdge, initialText: text});
      onNodeCreated?.({nodeId: newNode.id, edgeId: newEdge.id});
      return newEdge;
    },
    [bus, createNodeRecord, onNodeCreated]
  );

  const handleCreateSiblingAbove = useCallback(() => {
    if (!edge) {
      return false;
    }
    insertNode(edge.parentId, edge.ordinal, '');
    return true;
  }, [edge, insertNode]);

  const handleCreateSiblingBelow = useCallback(() => {
    if (edge) {
      insertNode(edge.parentId, edge.ordinal + 1, '');
    } else {
      insertNode(nodeRecord.id, 0, '');
    }
    return true;
  }, [edge, insertNode, nodeRecord.id]);

  const handleCreateChild = useCallback(() => {
    insertNode(nodeRecord.id, 0, '');
    return true;
  }, [insertNode, nodeRecord.id]);

  const handleSplitNode = useCallback(
    (after: string) => {
      flushPendingCommit();
      const parentId = edge ? edge.parentId : nodeRecord.id;
      const ordinal = edge ? edge.ordinal + 1 : 0;
      insertNode(parentId, ordinal, after);
      return true;
    },
    [edge, flushPendingCommit, insertNode, nodeRecord.id]
  );

  const handleEnterKey = useCallback<Command>(
    (state, dispatch) => {
      flushPendingCommit();

      if (!state.selection.empty) {
        return false;
      }

      const plainText = richTextDocToPlainText(state.doc);
      const caretOffset = computeCaretOffset(state);

      if (plainText.length === 0) {
        return handleCreateSiblingBelow();
      }

      if (caretOffset === 0) {
        return handleCreateSiblingAbove();
      }

      if (caretOffset === plainText.length) {
        if (hasVisibleChildren) {
          return handleCreateChild();
        }
        return handleCreateSiblingBelow();
      }

      if (!dispatch) {
        return false;
      }

      const parent = state.selection.$from.parent;
      const parentOffset = state.selection.$from.parentOffset;
      const deleteTo = state.selection.from + (parent.content.size - parentOffset);
      if (deleteTo > state.selection.from) {
        const tr: Transaction = state.tr.delete(state.selection.from, deleteTo);
        dispatch(tr);
      }
      flushPendingCommit();
      const afterText = plainText.slice(caretOffset);
      return handleSplitNode(afterText);
    },
    [flushPendingCommit, handleCreateChild, handleCreateSiblingAbove, handleCreateSiblingBelow, handleSplitNode, hasVisibleChildren]
  );

  const handleIndentKey = useCallback<Command>(
    (state) => {
      const caretOffset = computeCaretOffset(state);
      const handled = onTabCommand?.(edge ?? null, 'indent', caretOffset) ?? false;
      if (handled) {
        return true;
      }
      if (!edge) {
        return false;
      }
      flushPendingCommit();
      bus.execute({kind: 'indent-node', edgeId: edge.id, timestamp: timestamp()});
      return true;
    },
    [bus, edge, flushPendingCommit, onTabCommand]
  );

  const handleOutdentKey = useCallback<Command>(
    (state) => {
      const caretOffset = computeCaretOffset(state);
      const handled = onTabCommand?.(edge ?? null, 'outdent', caretOffset) ?? false;
      if (handled) {
        return true;
      }
      if (!edge) {
        return false;
      }
      flushPendingCommit();
      bus.execute({kind: 'outdent-node', edgeId: edge.id, timestamp: timestamp()});
      return true;
    },
    [bus, edge, flushPendingCommit, onTabCommand]
  );

  const handleBackspaceKey = useCallback<Command>(
    (state) => {
      if (!edge || !onBackspaceAtStart) {
        return false;
      }
      if (!state.selection.empty) {
        return false;
      }
      if (state.selection.$from.parentOffset !== 0) {
        return false;
      }
      flushPendingCommit();
      return onBackspaceAtStart(edge);
    },
    [edge, flushPendingCommit, onBackspaceAtStart]
  );

  const baseKeymapPlugin = useMemo(() => keymap(baseKeymap), []);

  const customKeymapPlugin = useMemo(
    () =>
      keymap({
        Enter: handleEnterKey,
        Tab: handleIndentKey,
        'Shift-Tab': handleOutdentKey,
        Backspace: handleBackspaceKey
      }),
    [handleBackspaceKey, handleEnterKey, handleIndentKey, handleOutdentKey]
  );

  const buildState = useCallback(
    (docNode: ProseMirrorNode) =>
      EditorState.create({
        schema: richTextSchema,
        doc: docNode,
        plugins: [ySyncPlugin(fragment), customKeymapPlugin, baseKeymapPlugin]
      }),
    [baseKeymapPlugin, customKeymapPlugin, fragment]
  );

  useEffect(() => {
    if (!stateRef.current) {
      return;
    }
    const currentDoc = stateRef.current.doc;
    const nextState = buildState(currentDoc);
    stateRef.current = nextState;
    const view = viewRef.current;
    if (view) {
      view.updateState(nextState);
    }
  }, [buildState]);

  if (!stateRef.current || previousNodeIdRef.current !== nodeId) {
    const initialDoc = plainTextToRichTextDoc(fallbackText);
    stateRef.current = buildState(initialDoc);
    previousNodeIdRef.current = nodeId;
    seededTextRef.current = fallbackText;
  } else if (fragment.length === 0 && seededTextRef.current !== fallbackText) {
    const nextState = buildState(plainTextToRichTextDoc(fallbackText));
    stateRef.current = nextState;
    seededTextRef.current = fallbackText;
    const existingView = viewRef.current;
    if (existingView) {
      existingView.updateState(nextState);
    }
  }

  useEffect(() => {
    if (!containerRef.current || !stateRef.current) {
      return;
    }

    const view = new EditorView({mount: containerRef.current}, {
      state: stateRef.current,
      dispatchTransaction: (transaction) => {
        const instance = viewRef.current;
        if (!instance) {
          return;
        }
        const nextState = instance.state.apply(transaction);
        stateRef.current = nextState;
        instance.updateState(nextState);

        if (!transaction.docChanged) {
          return;
        }

        const plain = richTextDocToPlainText(nextState.doc);
        syncPlainText(plain);

        const html = richTextDocToHtml(nextState.doc);
        scheduleCommit(html);
      },
      attributes: {
        'aria-label': `Node ${nodeId}`,
        role: 'textbox'
      },
      handleDOMEvents: {
        focus: () => {
          onFocusEdge?.(edge ? edge.id : null);
          return false;
        },
        blur: () => {
          onFocusEdge?.(null);
          flushPendingCommit();
          return false;
        }
      }
    });

    viewRef.current = view;
    if (containerRef.current) {
      (containerRef.current as unknown as {__pmView__?: EditorView}).__pmView__ = view;
    }

    return () => {
      view.destroy();
      viewRef.current = null;
      onFocusEdge?.(null);
      if (containerRef.current) {
        delete (containerRef.current as unknown as {__pmView__?: EditorView}).__pmView__;
      }
    };
  }, [edge, flushPendingCommit, nodeId, onFocusEdge, scheduleCommit, syncPlainText]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    handledDirectiveRef.current = null;
  }, [nodeId]);

  useEffect(() => {
    if (!focusDirective) {
      handledDirectiveRef.current = null;
      return;
    }

    if (handledDirectiveRef.current === focusDirective.requestId) {
      return;
    }

    const view = viewRef.current;
    if (!view) {
      return;
    }

    const docSize = view.state.doc.content.size;
    const nextPosition = focusDirective.position < 0
      ? docSize
      : Math.max(0, Math.min(focusDirective.position, docSize));

    const transaction = view.state.tr.setSelection(TextSelection.create(view.state.doc, nextPosition));
    const nextState = view.state.apply(transaction);
    stateRef.current = nextState;
    view.updateState(nextState);
    view.focus();

    handledDirectiveRef.current = focusDirective.requestId;
    onFocusDirectiveComplete?.(focusDirective.requestId);
  }, [focusDirective, onFocusDirectiveComplete]);

  return <div ref={containerRef} className={className} data-testid="prosemirror-node-editor" />;
};
