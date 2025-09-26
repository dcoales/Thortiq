import {createWebLexicalAdapter} from '../richtext';
import {renderTextWithWikiLinks} from '../wiki/render';
import {createThortiqDoc, ensureDocumentRoot, upsertNodeRecord} from '../yjs/doc';
import {createNodeId} from '../ids';

const normalizeHtml = (html: string): string => {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html.trim();
  return wrapper.innerHTML.replace(/\s+(?=<)/g, '').trim();
};

const timestamp = () => new Date().toISOString();
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('richtext html parity', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('exports identical DOM from adapter and stored html', async () => {
    const sampleText = 'Alpha [[Beta|id:node-b]]\nSecond line with  spaces';
    const storedHtml = renderTextWithWikiLinks(sampleText, {
      resolveTarget: (value) => (value.startsWith('id:') ? value.slice(3) : null),
      className: 'thq-wikilink'
    }).html;

    const doc = createThortiqDoc();
    ensureDocumentRoot(doc);
    const nodeId = createNodeId();
    upsertNodeRecord(doc, {
      id: nodeId,
      html: storedHtml,
      tags: [],
      attributes: {},
      createdAt: timestamp(),
      updatedAt: timestamp()
    });

    const container = document.createElement('div');
    document.body.appendChild(container);

    const adapter = createWebLexicalAdapter();
    const unmount = adapter.mount(container, {
      doc,
      nodeId,
      initialHtml: storedHtml,
      typographyClassName: 'thq-node-text'
    });

    await flushMicrotasks();
    const exportedHtml = adapter.getHtml();

    const normalizedStored = normalizeHtml(storedHtml);
    const normalizedExport = normalizeHtml(exportedHtml);
    expect(normalizedExport).toEqual(normalizedStored);

    const editorElement = container.querySelector('[data-lexical-editor="true"]');
    expect(editorElement).not.toBeNull();
    if (!(editorElement instanceof HTMLElement)) {
      throw new Error('Rich editor surface missing HTMLElement host');
    }
    expect(editorElement.classList.contains('thq-node-text')).toBe(true);

    unmount();
    adapter.destroy();
    container.remove();
  });
});


