/**
 * WebRichTextAdapterLexical (scaffold)
 *
 * Intent: Provide a concrete IRichTextAdapter for web environments behind a
 * stable contract, without wiring real Lexical yet. This keeps architecture
 * swappable and tests green. Internals currently use a lightweight
 * contentEditable surface to emulate interactions; a later step will replace
 * this with Lexical + yjs binding.
 */
import type {IRichTextAdapter, AdapterMountOptions, AdapterPoint, InsertWikiLinkPayload, Unmount, Unsubscribe} from '../adapter';
import type {NodeId} from '../../types';

type ChangeListener = (html: string, plainText: string) => void;

export class WebRichTextAdapterLexical implements IRichTextAdapter {
  private container: HTMLElement | null = null;
  private editorEl: HTMLDivElement | null = null;
  private typographyClass: string | undefined;
  private linkClickHandler: ((id: NodeId) => void) | undefined;
  private changeListeners: Set<ChangeListener> = new Set();

  private handleInput = () => {
    if (!this.editorEl) return;
    const html = this.getHtml();
    const plain = this.editorEl.textContent ?? '';
    this.changeListeners.forEach((cb) => cb(html, plain));
  };

  private handleClick = (ev: MouseEvent) => {
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    if (!target) return;
    const linkEl = target.closest('[data-wikilink="true"]');
    if (linkEl && this.linkClickHandler) {
      const id = linkEl.getAttribute('data-target-node-id');
      if (id) {
        ev.preventDefault();
        ev.stopPropagation();
        this.linkClickHandler(id);
      }
    }
  };

  mount(container: HTMLElement, options: AdapterMountOptions): Unmount {
    this.container = container;
    this.typographyClass = options.typographyClassName;
    this.linkClickHandler = options.onLinkClick;

    const host = document.createElement('div');
    host.style.width = '100%';
    host.style.height = '100%';
    host.style.outline = 'none';

    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.style.whiteSpace = 'pre-wrap';
    editor.style.wordBreak = 'break-word';
    editor.style.outline = 'none';
    editor.style.minHeight = '1em';
    if (this.typographyClass) editor.classList.add(this.typographyClass);
    editor.innerHTML = options.initialHtml;

    host.appendChild(editor);
    container.appendChild(host);

    this.editorEl = editor;
    editor.addEventListener('input', this.handleInput);
    editor.addEventListener('click', this.handleClick);

    return () => {
      editor.removeEventListener('input', this.handleInput);
      editor.removeEventListener('click', this.handleClick);
      if (this.container && host.parentElement === this.container) {
        this.container.removeChild(host);
      }
      this.editorEl = null;
      this.container = null;
    };
  }

  setHtml(html: string): void {
    if (!this.editorEl) return;
    this.editorEl.innerHTML = html;
  }

  getHtml(): string {
    return this.editorEl?.innerHTML ?? '';
  }

  getPlainText(): string {
    return this.editorEl?.textContent ?? '';
  }

  getSelectionOffset(): number {
    if (!this.editorEl) return 0;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const range = sel.getRangeAt(0);
    return textOffsetFromRange(this.editorEl, range);
  }

  focusAt(point: AdapterPoint): void {
    if (!this.editorEl) return;
    const rect = this.editorEl.getBoundingClientRect();
    const within = point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
    this.editorEl.focus();
    if (!within) {
      this.placeCaretAtEnd();
      return;
    }
    const range = caretRangeFromPointSafe(point.x, point.y);
    if (range) {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } else {
      this.placeCaretAtEnd();
    }
  }

  setSelection(offset: number): void {
    if (!this.editorEl) return;
    this.editorEl.focus();
    const range = rangeFromTextOffset(this.editorEl, Math.max(0, offset));
    const sel = window.getSelection();
    if (range && sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  onChange(cb: (html: string, plainText: string) => void): Unsubscribe {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  insertWikiLink(payload: InsertWikiLinkPayload): void {
    if (!this.editorEl) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      this.placeCaretAtEnd();
    }
    const current = window.getSelection();
    if (!current || current.rangeCount === 0) return;
    const range = current.getRangeAt(0);

    const span = document.createElement('span');
    span.setAttribute('data-wikilink', 'true');
    span.setAttribute('data-target-node-id', payload.targetNodeId);
    span.className = 'thq-wikilink';
    span.style.textDecoration = 'underline';
    span.style.cursor = 'pointer';
    span.style.color = '#2563eb';
    span.textContent = payload.display;

    range.deleteContents();
    range.insertNode(span);

    // Insert a trailing space if necessary to separate from next text
    const afterSpace = document.createTextNode(' ');
    if (!range.endContainer || range.endContainer !== span.nextSibling) {
      span.after(afterSpace);
    }

    // Move caret after the inserted span and space
    const newRange = document.createRange();
    newRange.setStartAfter(afterSpace);
    newRange.collapse(true);
    const sel2 = window.getSelection();
    if (sel2) {
      sel2.removeAllRanges();
      sel2.addRange(newRange);
    }
    this.handleInput();
  }

  destroy(): void {
    // No resources beyond DOM listeners currently.
    if (this.editorEl) {
      this.editorEl.removeEventListener('input', this.handleInput);
      this.editorEl.removeEventListener('click', this.handleClick);
    }
    this.editorEl = null;
    this.container = null;
    this.changeListeners.clear();
  }

  private placeCaretAtEnd(): void {
    if (!this.editorEl) return;
    const range = document.createRange();
    range.selectNodeContents(this.editorEl);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

// Utilities

type DocumentWithCaretRange = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

interface CaretPosition {
  readonly offsetNode: Node;
  readonly offset: number;
}

type DocumentWithCaretPosition = Document & {
  caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
};

const caretRangeFromPointSafe = (x: number, y: number): Range | null => {
  const d = document as DocumentWithCaretRange & DocumentWithCaretPosition;
  if (typeof d.caretRangeFromPoint === 'function') {
    const r = d.caretRangeFromPoint(x, y);
    return r ?? null;
  }
  if (typeof d.caretPositionFromPoint === 'function') {
    const pos = d.caretPositionFromPoint(x, y);
    if (pos) {
      const range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
      return range;
    }
  }
  return null;
};

const rangeFromTextOffset = (root: HTMLElement, targetOffset: number): Range | null => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let remaining = targetOffset;
  let node: Node | null = walker.nextNode();
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      return range;
    }
    remaining -= len;
    node = walker.nextNode();
  }
  // Fallback to end of root
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  return range;
};

const textOffsetFromRange = (root: HTMLElement, range: Range): number => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let offset = 0;
  let node: Node | null = walker.nextNode();
  const startContainer = range.startContainer;
  const startOffset = range.startOffset;
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (node === startContainer) {
      offset += Math.min(startOffset, len);
      break;
    }
    offset += len;
    node = walker.nextNode();
  }
  return offset;
};

/**
 * Factory: create a web lexical adapter instance (placeholder implementation).
 */
export const createWebLexicalAdapter = (): IRichTextAdapter => new WebRichTextAdapterLexical();
