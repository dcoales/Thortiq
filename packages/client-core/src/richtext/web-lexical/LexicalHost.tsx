/**
 * LexicalHost (scaffold)
 *
 * Responsibility: Minimal LexicalComposer tree that renders a content surface
 * with our typography class and reports content changes to the adapter. The
 * component intentionally avoids deep plugins until we wire lexical-yjs and
 * custom nodes. It is not used by default while the feature flag remains off.
 */
import {useEffect, useMemo} from 'react';
import type {CSSProperties} from 'react';
import {LexicalComposer} from '@lexical/react/LexicalComposer';
import {ContentEditable} from '@lexical/react/LexicalContentEditable';
import {RichTextPlugin} from '@lexical/react/LexicalRichTextPlugin';
import {OnChangePlugin} from '@lexical/react/LexicalOnChangePlugin';
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {$getRoot, type EditorState, type LexicalEditor} from 'lexical';
import {$generateNodesFromDOM, $generateHtmlFromNodes} from '@lexical/html';
import * as Y from 'yjs';
import {CollabXmlTextPlugin} from './plugins/CollabXmlTextPlugin';
// import type {EditorState} from 'lexical';

interface LexicalHostProps {
  readonly initialHtml: string;
  readonly typographyClassName?: string;
  readonly onChange?: (html: string, plainText: string) => void;
  readonly collabXmlText?: unknown;
}

const editorContainerStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  outline: 'none'
};

const ImportHtmlOnMount = ({html}: {html: string}) => {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.update(() => {
      const parser = new DOMParser();
      const dom = parser.parseFromString(html || '', 'text/html');
      const nodes = $generateNodesFromDOM(editor, dom);
      const root = $getRoot();
      root.clear();
      root.append(...nodes);
    });
  }, [editor, html]);
  return null;
};

export const LexicalHost = ({initialHtml, typographyClassName, onChange, collabXmlText}: LexicalHostProps) => {

  const initialConfig = useMemo(() => ({
    namespace: 'thortiq-lexical',
    // Theme maps lexical nodes to classNames; we zero margins on paragraphs
    // to preserve single-line row height parity.
    theme: {
      paragraph: 'thq-rt-paragraph'
    },
    onError: (err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('Lexical error', err);
    }
  }), []);

  // Ensure theme CSS exists exactly once (idempotent injection)
  useEffect(() => {
    const STYLE_ID = 'thq-rt-lexical-theme';
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .thq-rt-paragraph { margin: 0; }
      .thq-rt-paragraph:first-child { margin-top: 0; }
      .thq-rt-paragraph:last-child { margin-bottom: 0; }
    `;
    document.head.appendChild(style);
  }, []);

  const handleChange = (editorState: EditorState, editor: LexicalEditor) => {
    editorState.read(() => {
      const html = $generateHtmlFromNodes(editor, null);
      const text = $getRoot().getTextContent();
      onChange?.(html, text);
    });
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div style={editorContainerStyle}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className={typographyClassName}
              style={{whiteSpace: 'pre-wrap', wordBreak: 'break-word', outline: 'none', minHeight: '1em'}}
            />
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ImportHtmlOnMount html={initialHtml} />
        <OnChangePlugin onChange={handleChange} />
        {collabXmlText instanceof Y.XmlText ? (
          <CollabXmlTextPlugin xmlText={collabXmlText} />
        ) : null}
      </div>
    </LexicalComposer>
  );
};
