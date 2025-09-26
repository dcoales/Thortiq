/**
 * web-lexical/adapter.ts
 *
 * Responsibility: Browser Lexical implementation of the IRichTextAdapter
 * contract. Translates Lexical editor state to HTML/plain text, mirrors
 * changes into the shared Yjs document (both plain text and XmlText sidecars),
 * and reacts to remote XmlText updates without disturbing the user's caret.
 */

import {createEditor, $createParagraphNode, $createRangeSelection, $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isRootNode, $setSelection, ParagraphNode, TextNode, type LexicalEditor, type LexicalNode} from 'lexical';
import {$generateHtmlFromNodes, $generateNodesFromDOM} from '@lexical/html';
import * as Y from 'yjs';

import type {
  AdapterMountOptions,
  AdapterPoint,
  InsertWikiLinkPayload,
  IRichTextAdapter,
  Unmount,
  Unsubscribe
} from '../adapter';
import {caretRangeFromPoint, rangeFromTextOffset, textOffsetFromRange} from '../../utils/caret';
import {htmlToPlainText} from '../../utils/text';
import type {NodeId} from '../../types';
import {getOrCreateNodeText, getOrCreateNodeXml} from '../../yjs/doc';
import {LOCAL_ORIGIN} from '../../yjs/undo';

type ChangeListener = (html: string, plainText: string) => void;

type ApplyHtmlOptions = {
  readonly fromXml?: boolean;
  readonly preserveSelection?: boolean;
  readonly caretOffset?: number;
};

const EMPTY_HTML_FALLBACK = '<p><br/></p>';

const ySharedTextToString = (value: Y.Text | Y.XmlText | null): string => {
  if (!value) {
    return '';
  }
  const json = value.toJSON();
  return typeof json === 'string' ? json : '';
};

const extractTransaction = (event: Y.YTextEvent): {origin?: unknown} | null => {
  const candidate = event as unknown as {transaction?: {origin?: unknown}};
  return candidate.transaction ?? null;
};
const BREAK_TAG_REGEX = /<br\s*\/?>/gi;
const BREAK_ONLY_REGEX = /^(?:\s|<br\s*\/?>)*$/i;

const normalizeCanonicalHtml = (html: string): string =>
  html
    .replace(/\r?\n/g, '\n')
    .replace(BREAK_TAG_REGEX, '\n')
    .replace(/\u00a0/g, ' ');

const encodeSpacesForLexical = (value: string): string => {
  if (value.length === 0) {
    return value;
  }
  let result = value.replace(/\u00a0/g, ' ');
  const leading = result.match(/^ +/);
  if (leading) {
    result = '\u00a0'.repeat(leading[0].length) + result.slice(leading[0].length);
  }
  const trailing = result.match(/ +$/);
  if (trailing) {
    result = result.slice(0, -trailing[0].length) + '\u00a0'.repeat(trailing[0].length);
  }
  result = result.replace(/ {2,}/g, (match) => ' ' + '\u00a0'.repeat(match.length - 1));
  return result;
};

const decodeSpacesFromLexical = (value: string): string => value.replace(/\u00a0/g, ' ');

const canonicalToLexicalHtml = (html: string): string => {
  if (html.length === 0) {
    return EMPTY_HTML_FALLBACK;
  }
  const normalized = normalizeCanonicalHtml(html);
  const segments = normalized.split('\n');
  if (segments.length === 0) {
    return EMPTY_HTML_FALLBACK;
  }
  const paragraphs = segments.map((segment) => {
    if (segment.length === 0) {
      return '<p><br/></p>';
    }
    const container = document.createElement('div');
    container.innerHTML = segment;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    let node: Node | null = walker.nextNode();
    while (node) {
      const current = node.textContent ?? '';
      const encoded = encodeSpacesForLexical(current);
      if (encoded !== current) {
        node.textContent = encoded;
      }
      node = walker.nextNode();
    }
    return `<p>${container.innerHTML}</p>`;
  });
  return paragraphs.join('');
};

const lexicalHtmlToCanonical = (html: string): string => {
  if (html.length === 0) {
    return '';
  }
  const container = document.createElement('div');
  container.innerHTML = html;
  const paragraphs = Array.from(container.querySelectorAll('p'));
  if (paragraphs.length === 0) {
    return normalizeCanonicalHtml(container.innerHTML);
  }
  const parts: string[] = [];
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) {
      parts.push('\n');
    }
    const inner = paragraph.innerHTML;
    if (inner.length === 0 || BREAK_ONLY_REGEX.test(inner)) {
      return;
    }
    const clone = paragraph.cloneNode(true) as HTMLElement;
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null);
    let node: Node | null = walker.nextNode();
    while (node) {
      const current = node.textContent ?? '';
      const decoded = decodeSpacesFromLexical(current);
      if (decoded !== current) {
        node.textContent = decoded;
      }
      node = walker.nextNode();
    }
    parts.push(normalizeCanonicalHtml(clone.innerHTML));
  });
  return parts.join('');
};

const ensureCanonicalHtml = (html: string): string => {
  if (html.length === 0) {
    return '';
  }
  return normalizeCanonicalHtml(lexicalHtmlToCanonical(html));
};

const normalizeLexicalOutput = (html: string): string => {
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll('span').forEach((span) => {
    if (span instanceof HTMLElement && span.style && span.style.whiteSpace === 'pre-wrap' && span.parentElement && span.parentElement.tagName === 'P') {
      const textContent = span.textContent ?? '';
      span.replaceWith(document.createTextNode(textContent));
    }
  });
  return container.innerHTML;
};
const collectWikiLinkSpans = (html: string): Array<{text: string; attrs: Record<string, string>}> => {
  const container = document.createElement('div');
  container.innerHTML = html;
  const results: Array<{text: string; attrs: Record<string, string>}> = [];
  container.querySelectorAll('span[data-wikilink]')?.forEach((span) => {
    if (!(span instanceof HTMLElement)) {
      return;
    }
    const attrs: Record<string, string> = {};
    Array.from(span.attributes).forEach((attr) => {
      attrs[attr.name] = attr.value;
    });
    results.push({text: span.textContent ?? '', attrs});
  });
  return results;
};

const restoreWikiLinkSpans = (previousHtml: string | null, sanitizedHtml: string): string => {
  const container = document.createElement('div');
  container.innerHTML = sanitizedHtml;
  const wikiSpans = previousHtml ? collectWikiLinkSpans(previousHtml) : [];
  if (wikiSpans.length > 0) {
    let index = 0;
    const underlineNodes = Array.from(container.querySelectorAll('u'));
    underlineNodes.forEach((underline) => {
      if (index >= wikiSpans.length) {
        return;
      }
      const innerSpan = underline.firstElementChild;
      if (!(innerSpan instanceof HTMLElement) || innerSpan.tagName !== 'SPAN') {
        return;
      }
      if (innerSpan.style.whiteSpace !== 'pre-wrap') {
        return;
      }
      const {text, attrs} = wikiSpans[index];
      index += 1;
      const replacement = document.createElement('span');
      Object.entries(attrs).forEach(([key, value]) => {
        replacement.setAttribute(key, value);
      });
      replacement.textContent = innerSpan.textContent ?? text;
      underline.replaceWith(replacement);
    });
  }
  container.querySelectorAll('span').forEach((span) => {
    if (!(span instanceof HTMLElement)) {
      return;
    }
    if (span.hasAttribute('data-wikilink')) {
      return;
    }
    if (span.style.whiteSpace === 'pre-wrap') {
      span.replaceWith(document.createTextNode(span.textContent ?? ''));
    }
  });
  return container.innerHTML;
};

const moveCaretToOffset = (editor: LexicalEditor, offset: number): void => {
  editor.update(() => {
    const root = $getRoot();
    const textNodes = root.getAllTextNodes();
    if (textNodes.length === 0) {
      return;
    }
    let remaining = offset;
    let target = textNodes[textNodes.length - 1];
    let targetOffset = target.getTextContentSize();
    for (const node of textNodes) {
      const length = node.getTextContentSize();
      if (remaining <= length) {
        target = node;
        targetOffset = remaining;
        break;
      }
      remaining -= length;
    }
    const selection = $createRangeSelection();
    selection.anchor.set(target.getKey(), targetOffset, 'text');
    selection.focus.set(target.getKey(), targetOffset, 'text');
    $setSelection(selection);
  });
};

const unwrapStructuralNodes = (nodes: ReadonlyArray<LexicalNode>): LexicalNode[] => {
  const result: LexicalNode[] = [];
  nodes.forEach((node) => {
    if ($isRootNode(node)) {
      result.push(...unwrapStructuralNodes(node.getChildren()));
      return;
    }
    if ($isElementNode(node)) {
      const type = node.getType();
      if (type === 'html' || type === 'body') {
        result.push(...unwrapStructuralNodes(node.getChildren()));
        return;
      }
    }
    result.push(node);
  });
  return result;
};

export class WebRichTextAdapterLexical implements IRichTextAdapter {
  private container: HTMLElement | null = null;
  private host: HTMLDivElement | null = null;
  private editorElement: HTMLDivElement | null = null;
  private editor: LexicalEditor | null = null;
  private typographyClass: string | undefined;
  private linkClickHandler: ((id: NodeId) => void) | undefined;
  private changeListeners: Set<ChangeListener> = new Set();
  private doc: Y.Doc | null = null;
  private nodeId: NodeId | null = null;
  private yXmlText: Y.XmlText | null = null;
  private yPlainText: Y.Text | null = null;
  private xmlObserver: ((event: Y.YTextEvent) => void) | null = null;
  private updateDisposer: (() => void) | null = null;
  private isApplyingExternalUpdate = false;
  private suppressXmlObserver = false;
  private lastBroadcastCanonical: string | null = null;

  private readonly handleClick = (event: MouseEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) {
      return;
    }
    const link = target.closest('[data-wikilink="true"]');
    if (!link || !this.linkClickHandler) {
      return;
    }
    const idAttr = (link as HTMLElement).getAttribute('data-target-node-id');
    if (typeof idAttr === 'string') {
      event.preventDefault();
      event.stopPropagation();
      this.linkClickHandler(idAttr);
    }
  };

  mount(container: HTMLElement, options: AdapterMountOptions): Unmount {
    this.container = container;
    this.doc = options.doc;
    this.nodeId = options.nodeId;
    this.typographyClass = options.typographyClassName ?? 'thq-node-text';
    this.linkClickHandler = options.onLinkClick;

    const host = document.createElement('div');
    host.style.width = '100%';
    host.style.height = '100%';
    host.style.position = 'relative';
    host.style.display = 'block';

    const editorElement = document.createElement('div');
    editorElement.className = this.typographyClass;
    editorElement.setAttribute('data-lexical-editor', 'true');
    editorElement.style.width = '100%';
    editorElement.style.whiteSpace = 'pre-wrap';
    editorElement.style.wordBreak = 'break-word';
    editorElement.style.outline = 'none';
    editorElement.style.minHeight = '1em';

    host.appendChild(editorElement);
    container.appendChild(host);

    this.host = host;
    this.editorElement = editorElement;

    const editor = createEditor({
      namespace: 'thortiq-rich-text',
      nodes: [ParagraphNode, TextNode],
      onError(error) {
        throw error;
      }
    });
    this.editor = editor;
    editor.setRootElement(editorElement);

    editorElement.addEventListener('click', this.handleClick);

    const initialHtml = options.initialHtml ?? '';
    this.initializeYjs(initialHtml);
    this.applyHtml(initialHtml, {fromXml: false, preserveSelection: false});

    this.updateDisposer = editor.registerUpdateListener(({editorState}) => {
      if (this.isApplyingExternalUpdate) {
        return;
      }
      editorState.read(() => {
        const lexicalHtml = $generateHtmlFromNodes(editor);
        const previousCanonical = this.lastBroadcastCanonical;
        const normalizedLexical = normalizeLexicalOutput(lexicalHtml);
        const lexicalWithWiki = restoreWikiLinkSpans(previousCanonical, normalizedLexical);
        const canonicalHtml = ensureCanonicalHtml(lexicalWithWiki);
        if (this.lastBroadcastCanonical === canonicalHtml) {
          return;
        }
        const plain = htmlToPlainText(canonicalHtml);
        this.lastBroadcastCanonical = canonicalHtml;
        this.updatePlainText(plain);
        this.updateXml(canonicalHtml);
        this.emitChange(canonicalHtml, plain);
      });
    });

    // Focus caret at end once mounted so keyboard commands act immediately.
    editor.update(() => {
      const root = $getRoot();
      const lastChild = root.getLastChild();
      if (lastChild) {
        lastChild.selectEnd();
      } else {
        root.selectEnd();
      }
    });

    return () => {
      this.detachEditor();
    };
  }

  setHtml(html: string): void {
    const caretOffset = this.getSelectionOffset();
    this.applyHtml(html, {fromXml: false, preserveSelection: true, caretOffset});
  }


  getHtml(): string {
    return this.lastBroadcastCanonical ?? '';
  }
  getPlainText(): string {
    if (!this.editor) {
      return '';
    }
    let text = '';
    this.editor.getEditorState().read(() => {
      text = $getRoot().getTextContent();
    });
    return text;
  }

  getSelectionOffset(): number {
    if (!this.editorElement) {
      return 0;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return 0;
    }
    const range = selection.getRangeAt(0);
    return textOffsetFromRange(this.editorElement, range);
  }

  focusAt(point: AdapterPoint): void {
    if (!this.editorElement) {
      return;
    }
    this.editorElement.focus({preventScroll: true});
    const range = caretRangeFromPoint(point.x, point.y);
    if (!range || !this.editorElement.contains(range.startContainer)) {
      this.placeCaretAtEnd();
      return;
    }
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  setSelection(offset: number): void {
    if (!this.editorElement) {
      return;
    }
    const normalized = Math.max(0, offset);
    const range = rangeFromTextOffset(this.editorElement, normalized);
    this.editorElement.focus({preventScroll: true});
    if (!range) {
      this.placeCaretAtEnd();
      if (this.editor) {
        moveCaretToOffset(this.editor, normalized);
      }
      return;
    }
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (this.editor) {
      moveCaretToOffset(this.editor, normalized);
    }
  }

  onChange(cb: (html: string, plainText: string) => void): Unsubscribe {
    this.changeListeners.add(cb);
    return () => {
      this.changeListeners.delete(cb);
    };
  }

  insertWikiLink(payload: InsertWikiLinkPayload): void {
    const editor = this.editor;
    if (!editor) {
      return;
    }
    const html = `<span data-wikilink="true" data-target-node-id="${payload.targetNodeId}" class="thq-wikilink" style="text-decoration: underline; cursor: pointer; color: #2563eb;">${payload.display}</span>`;
    const parser = new DOMParser();
    const dom = parser.parseFromString(`${html} `, 'text/html');
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        return;
      }
      const nodes = unwrapStructuralNodes($generateNodesFromDOM(editor, dom));
      nodes.forEach((node: LexicalNode) => selection.insertNodes([node]));
    });

  }
  destroy(): void {
    this.detachEditor();
    this.changeListeners.clear();
    this.doc = null;
    this.nodeId = null;
    this.yXmlText = null;
    this.yPlainText = null;
    this.lastBroadcastCanonical = null;
  }

  private initializeYjs(initialHtml: string): void {
    if (!this.doc || !this.nodeId) {
      return;
    }
    const canonicalInitial = ensureCanonicalHtml(initialHtml);
    const initialPlain = htmlToPlainText(canonicalInitial);
    this.yPlainText = getOrCreateNodeText(this.doc, this.nodeId, initialPlain);
    this.yXmlText = getOrCreateNodeXml(this.doc, this.nodeId);

    let storedHtml = ySharedTextToString(this.yXmlText);
    const canonicalStored = ensureCanonicalHtml(storedHtml);

    if (storedHtml !== canonicalStored) {
      this.suppressXmlObserver = true;
      this.doc.transact(() => {
        this.yXmlText!.delete(0, this.yXmlText!.length);
        if (canonicalStored.length > 0) {
          this.yXmlText!.insert(0, canonicalStored);
        }
      }, LOCAL_ORIGIN);
      this.suppressXmlObserver = false;
      storedHtml = canonicalStored;
    }

    if (storedHtml.length === 0 && canonicalInitial.length > 0) {
      this.suppressXmlObserver = true;
      this.doc.transact(() => {
        this.yXmlText!.delete(0, this.yXmlText!.length);
        this.yXmlText!.insert(0, canonicalInitial);
      }, LOCAL_ORIGIN);
      this.suppressXmlObserver = false;
      storedHtml = canonicalInitial;
    }
    const observer = (event: Y.YTextEvent) => {
      if (this.suppressXmlObserver) {
        return;
      }
      const transaction = extractTransaction(event);
      if (transaction && transaction.origin === LOCAL_ORIGIN) {
        return;
      }
      const html = ensureCanonicalHtml(ySharedTextToString(this.yXmlText));
      const caretOffset = this.getSelectionOffset();
      this.applyHtml(html, {fromXml: true, preserveSelection: true, caretOffset});
    };
    this.yXmlText.observe(observer);
    this.xmlObserver = observer;
  }

  private applyHtml(html: string, {fromXml, preserveSelection, caretOffset}: ApplyHtmlOptions): void {
    const editor = this.editor;
    if (!editor) {
      return;
    }
    const canonical = ensureCanonicalHtml(html);
    const previousCanonical = this.lastBroadcastCanonical ?? canonical;
    const lexicalHtml = canonicalToLexicalHtml(canonical);
    const normalizedLexical = normalizeLexicalOutput(lexicalHtml);
    const lexicalWithWiki = restoreWikiLinkSpans(previousCanonical, normalizedLexical);
    const nextCanonical = ensureCanonicalHtml(lexicalWithWiki);
    const parser = new DOMParser();
    const dom = parser.parseFromString(lexicalWithWiki, 'text/html');
    const plain = htmlToPlainText(nextCanonical);
    if (nextCanonical === this.lastBroadcastCanonical) {
      if (preserveSelection && typeof caretOffset === 'number') {
        const nextOffset = Math.min(caretOffset, plain.length);
        setTimeout(() => {
          this.setSelection(nextOffset);
        }, 0);
      }
      return;
    }
    this.isApplyingExternalUpdate = true;
    try {
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        const nodes = unwrapStructuralNodes($generateNodesFromDOM(editor, dom));
        if (nodes.length === 0) {
          root.append($createParagraphNode());
        } else {
          nodes.forEach((node: LexicalNode) => {
            root.append(node);
          });
        }
      });
      if (!fromXml) {
        this.updatePlainText(plain);
        this.updateXml(nextCanonical);
      }
      this.lastBroadcastCanonical = nextCanonical;
    } finally {
      this.isApplyingExternalUpdate = false;
    }

    if (preserveSelection && typeof caretOffset === 'number') {
      const nextOffset = Math.min(caretOffset, plain.length);
      setTimeout(() => {
        this.setSelection(nextOffset);
      }, 0);
    }
  }
  private updatePlainText(plain: string): void {
    if (!this.doc || !this.yPlainText) {
      return;
    }
    const current = ySharedTextToString(this.yPlainText);
    if (current === plain) {
      return;
    }
    this.doc.transact(() => {
      this.yPlainText!.delete(0, this.yPlainText!.length);
      if (plain.length > 0) {
        this.yPlainText!.insert(0, plain);
      }
    }, LOCAL_ORIGIN);
  }

  private updateXml(html: string): void {
    if (!this.doc || !this.yXmlText) {
      return;
    }
    const current = ensureCanonicalHtml(ySharedTextToString(this.yXmlText));
    if (current === html) {
      return;
    }
    this.suppressXmlObserver = true;
    this.doc.transact(() => {
      this.yXmlText!.delete(0, this.yXmlText!.length);
      if (html.length > 0) {
        this.yXmlText!.insert(0, html);
      }
    }, LOCAL_ORIGIN);
    this.suppressXmlObserver = false;
  }
  private emitChange(html: string, plain: string): void {
    this.changeListeners.forEach((cb) => cb(html, plain));
  }

  private placeCaretAtEnd(): void {
    if (!this.editorElement) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(this.editorElement);
    range.collapse(false);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  private detachEditor(): void {
    if (this.updateDisposer) {
      this.updateDisposer();
      this.updateDisposer = null;
    }
    if (this.editorElement) {
      this.editorElement.removeEventListener('click', this.handleClick);
    }
    if (this.editor) {
      this.editor.setRootElement(null);
      this.editor = null;
    }
    if (this.xmlObserver && this.yXmlText) {
      this.yXmlText.unobserve(this.xmlObserver);
      this.xmlObserver = null;
    }
    if (this.host && this.container && this.host.parentElement === this.container) {
      this.container.removeChild(this.host);
    }
    this.host = null;
    this.editorElement = null;
    this.container = null;
  }
}

export const createWebLexicalAdapter = (): IRichTextAdapter => new WebRichTextAdapterLexical();






























