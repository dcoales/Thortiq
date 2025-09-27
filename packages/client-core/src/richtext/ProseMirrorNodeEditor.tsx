import {useCallback, useEffect, useMemo, useRef} from 'react';
import type {Node as ProseMirrorNode} from 'prosemirror-model';
import {EditorState, TextSelection} from 'prosemirror-state';
import {EditorView} from 'prosemirror-view';
import {keymap} from 'prosemirror-keymap';
import {baseKeymap} from 'prosemirror-commands';
import * as Y from 'yjs';

import type {NodeEditorProps} from '../components/NodeEditor';
import {useNodeText} from '../hooks/useNodeText';
import {useCommandBus} from '../hooks/commandBusContext';
import {useYDoc} from '../hooks/yDocContext';
import {useDocVersion} from '../hooks/useDocVersion';
import {getOrCreateNodeRichText, initializeCollections} from '../yjs/doc';
import {ySyncPlugin} from 'y-prosemirror';
import {
  htmlToRichTextDoc,
  plainTextToRichTextDoc,
  richTextDocToHtml,
  richTextDocToPlainText
} from './serializers';
import {richTextSchema} from './schema';
import {
  createBackspaceCommand,
  createEnterCommand,
  createIndentCommand,
  createOutdentCommand,
  type CommandContext
} from './commands';

const timestamp = () => new Date().toISOString();
const COMMIT_DEBOUNCE_MS = 75;
interface PendingCommit {
  readonly html: string;
}

const computeSelectionOffsets = (state: EditorState) => ({
  start: state.doc.textBetween(0, state.selection.from, '\n', '\n').length,
  end: state.doc.textBetween(0, state.selection.to, '\n', '\n').length
});

const resolveTextOffset = (doc: ProseMirrorNode, offset: number): number => {
  let remaining = offset;
  let position = 1;
  doc.descendants((node, pos) => {
    if (!node.isText) {
      return true;
    }
    const text = node.text ?? '';
    if (remaining <= text.length) {
      position = pos + remaining;
      return false;
    }
    remaining -= text.length;
    position = pos + text.length;
    return true;
  });
  const maxPos = Math.max(1, doc.content.size - 1);
  return Math.max(1, Math.min(position, maxPos));
};

type EditorDomBridge = HTMLDivElement & {
  __pmView__?: EditorView;
  setSelectionRange?: (start: number, end: number) => void;
};

const attachEditorTestingBridge = (element: EditorDomBridge, view: EditorView) => {
  element.setSelectionRange = (start: number, end: number) => {
    const doc = view.state.doc;
    const from = resolveTextOffset(doc, Math.min(start, end));
    const to = resolveTextOffset(doc, Math.max(start, end));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, from, to)));
    view.focus();
  };

  Object.defineProperty(element, 'selectionStart', {
    configurable: true,
    get: () => computeSelectionOffsets(view.state).start
  });

  Object.defineProperty(element, 'selectionEnd', {
    configurable: true,
    get: () => computeSelectionOffsets(view.state).end
  });

  Object.defineProperty(element, 'value', {
    configurable: true,
    get: () => view.state.doc.textContent
  });
};

/**
 * ProseMirror-backed editor that mirrors the classic textarea behaviours
 * (Enter/Backspace/Tab) while persisting changes through Yjs and the CommandBus.
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

  const commandContext = useMemo<CommandContext>(
    () => ({
      nodeId,
      edge,
      doc,
      bus,
      flushDebouncedCommit: flushPendingCommit,
      hasVisibleChildren: () => hasVisibleChildren,
      onNodeCreated,
      onTabCommand,
      onBackspaceAtStart
    }),
    [bus, doc, edge, flushPendingCommit, hasVisibleChildren, nodeId, onBackspaceAtStart, onNodeCreated, onTabCommand]
  );

  const enterCommand = useMemo(() => createEnterCommand(commandContext), [commandContext]);
  const indentCommand = useMemo(() => createIndentCommand(commandContext), [commandContext]);
  const outdentCommand = useMemo(() => createOutdentCommand(commandContext), [commandContext]);
  const backspaceCommand = useMemo(() => createBackspaceCommand(commandContext), [commandContext]);

  const baseKeymapPlugin = useMemo(() => keymap(baseKeymap), []);

  const customKeymapPlugin = useMemo(
    () =>
      keymap({
        Enter: enterCommand,
        Tab: indentCommand,
        'Shift-Tab': outdentCommand,
        Backspace: backspaceCommand
      }),
    [backspaceCommand, enterCommand, indentCommand, outdentCommand]
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
    const initialDoc = nodeRecord.html.length > 0
      ? htmlToRichTextDoc(nodeRecord.html)
      : plainTextToRichTextDoc(fallbackText);
    stateRef.current = buildState(initialDoc);
    previousNodeIdRef.current = nodeId;
    seededTextRef.current = richTextDocToPlainText(initialDoc);
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
      const mount = containerRef.current as EditorDomBridge;
      mount.__pmView__ = view;
      attachEditorTestingBridge(mount, view);
    }

    return () => {
      view.destroy();
      viewRef.current = null;
      onFocusEdge?.(null);
      if (containerRef.current) {
        delete (containerRef.current as unknown as {__pmView__?: EditorView}).__pmView__;
      }
    };
  }, [edge, flushPendingCommit, nodeId, onFocusEdge, scheduleCommit]);

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
