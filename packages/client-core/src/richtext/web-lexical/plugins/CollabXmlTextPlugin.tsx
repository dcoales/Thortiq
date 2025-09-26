/**
 * CollabXmlTextPlugin
 *
 * Responsibility: Minimal offline Yjs binding that mirrors editor HTML into a
 * Y.XmlText sidecar, and applies external XmlText updates back into Lexical.
 * This is a pragmatic interim step before wiring @lexical/yjs provider-level
 * binding. It avoids feedback loops via last-applied guards.
 */
import {useEffect, useRef} from 'react';
import * as Y from 'yjs';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {$generateHtmlFromNodes, $generateNodesFromDOM} from '@lexical/html';
import {$getRoot} from 'lexical';
import {LOCAL_ORIGIN} from '../../../yjs/undo';

interface CollabXmlTextPluginProps {
  readonly xmlText: Y.XmlText;
}

export const CollabXmlTextPlugin = ({xmlText}: CollabXmlTextPluginProps) => {
  const [editor] = useLexicalComposerContext();
  const lastPushedHtml = useRef<string>('');
  const lastPulledHtml = useRef<string>('');

  // Push editor changes into XmlText
  useEffect(() => {
    const remove = editor.registerUpdateListener(({editorState}) => {
      editorState.read(() => {
        const html = $generateHtmlFromNodes(editor, undefined);
        if (html === lastPushedHtml.current) return;
        lastPushedHtml.current = html;
        const doc = xmlText.doc as Y.Doc | undefined;
        if (!doc) return;
        doc.transact(() => {
          xmlText.delete(0, xmlText.length);
          if (html.length > 0) xmlText.insert(0, html);
        }, LOCAL_ORIGIN);
      });
    });
    return remove;
  }, [editor, xmlText]);

  // Apply XmlText external updates into editor
  useEffect(() => {
    const observer = (_event: unknown, transaction: unknown) => {
      // Ignore local transactions to preserve caret during typing
      // and avoid ping-pong updates.
      const tr = transaction as { origin?: unknown };
      if (tr && tr.origin === LOCAL_ORIGIN) {
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const html: string = xmlText.toString();
      if (html === lastPulledHtml.current) return;
      lastPulledHtml.current = html;
      editor.update(() => {
        const parser = new DOMParser();
        const dom = parser.parseFromString(html || '', 'text/html');
        const nodes = $generateNodesFromDOM(editor, dom);
        const root = $getRoot();
        root.clear();
        root.append(...nodes);
      });
    };
    // Observe Y.XmlText updates (event, transaction)
    (xmlText as unknown as { observe: (h: (e: unknown, t: unknown) => void) => void }).observe(observer);
    return () => (xmlText as unknown as { unobserve: (h: (e: unknown, t: unknown) => void) => void }).unobserve(observer);
  }, [editor, xmlText]);

  return null;
};
