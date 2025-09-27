/**
 * Factory for constructing ProseMirror editors shared across platforms.
 * Encapsulates view creation so callers can align with
 * docs/rich_text_editor_requirements.md without re-implementing plumbing.
 */
import {baseKeymap} from 'prosemirror-commands';
import {keymap} from 'prosemirror-keymap';
import type {EditorState, Plugin, Transaction} from 'prosemirror-state';
import {EditorState as PMEditorState, TextSelection} from 'prosemirror-state';
import type {EditorView} from 'prosemirror-view';
import {EditorView as PMEditorView} from 'prosemirror-view';
import {ySyncPlugin} from 'y-prosemirror';
import type * as Y from 'yjs';

import type {EdgeId, EdgeRecord, NodeId} from '../types';
import type {Node as ProseMirrorNode} from 'prosemirror-model';
import {richTextSchema} from './schema';
import {createEmptyRichTextDoc} from './serializers';

export interface RichTextTransactionContext {
  readonly transaction: Transaction;
  readonly state: EditorState;
  readonly view: EditorView;
}

export interface CreateRichTextEditorOptions {
  readonly fragment: Y.XmlFragment;
  readonly nodeId: NodeId;
  readonly edge: EdgeRecord | null;
  readonly initialDoc?: Parameters<typeof PMEditorState.create>[0]['doc'];
  readonly onFocusEdge?: (edgeId: EdgeId | null) => void;
  readonly onTransaction?: (context: RichTextTransactionContext) => void;
  readonly commandHooks?: readonly Plugin[];
  readonly triggerPlugins?: readonly Plugin[];
}

export interface RichTextEditorHandle {
  mount(dom: HTMLElement): void;
  destroy(): void;
  focusAt(offset: number | 'preserve'): void;
  getView(): EditorView | null;
}

const clampSelection = (doc: ProseMirrorNode, offset: number): number => {
  const size = doc.content.size;
  if (size <= 2) {
    return 1;
  }
  return Math.max(1, Math.min(offset, size - 1));
};

export const createRichTextEditor = (options: CreateRichTextEditorOptions): RichTextEditorHandle => {
  let view: EditorView | null = null;
  let lastSelection: {from: number; to: number} | null = null;

  const buildPlugins = () => [
    ySyncPlugin(options.fragment),
    ...(options.commandHooks ?? []),
    ...(options.triggerPlugins ?? []),
    keymap(baseKeymap)
  ];

  const createState = (doc: ProseMirrorNode = createEmptyRichTextDoc()) =>
    PMEditorState.create({
      schema: richTextSchema,
      doc,
      plugins: buildPlugins()
    });

  const destroy = () => {
    if (!view) {
      return;
    }
    view.destroy();
    view = null;
    lastSelection = null;
    options.onFocusEdge?.(null);
  };

  const mount = (dom: HTMLElement) => {
    if (view) {
      return;
    }

    const state = createState(options.initialDoc);
    const newView = new PMEditorView({mount: dom}, {
      state,
      dispatchTransaction: (transaction) => {
        if (!view) {
          return;
        }
        const nextState = view.state.apply(transaction);
        view.updateState(nextState);
        lastSelection = {
          from: nextState.selection.from,
          to: nextState.selection.to
        };
        options.onTransaction?.({transaction, state: nextState, view});
      },
      attributes: {
        'aria-label': `Node ${options.nodeId}`,
        role: 'textbox'
      },
      handleDOMEvents: {
        focus: () => {
          options.onFocusEdge?.(options.edge ? options.edge.id : null);
          return false;
        },
        blur: () => {
          options.onFocusEdge?.(null);
          return false;
        }
      }
    });

    view = newView;
    lastSelection = {
      from: state.selection.from,
      to: state.selection.to
    };
  };

  const focusAt = (offset: number | 'preserve') => {
    if (!view) {
      return;
    }
    const targetSelection = (() => {
      if (offset === 'preserve') {
        return lastSelection ?? {from: 1, to: 1};
      }
      const doc = view.state.doc;
      const pos = clampSelection(doc, offset + 1);
      return {from: pos, to: pos};
    })();

    const transaction = view.state.tr.setSelection(
      TextSelection.create(view.state.doc, targetSelection.from, targetSelection.to)
    );
    view.dispatch(transaction);
    view.focus();
  };

  const getView = () => view;

  return {
    mount,
    destroy,
    focusAt,
    getView
  };
};
