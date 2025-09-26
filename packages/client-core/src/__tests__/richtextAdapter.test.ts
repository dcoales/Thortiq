import * as Y from 'yjs';
import {createWebLexicalAdapter} from '../richtext';
import {createThortiqDoc, ensureDocumentRoot, upsertNodeRecord, getOrCreateNodeXml} from '../yjs/doc';
import {createNodeId} from '../ids';
import {LOCAL_ORIGIN, REMOTE_ORIGIN} from '../yjs/undo';

const timestamp = () => new Date().toISOString();
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('richtext adapter caret & yjs integration', () => {
  const setup = async (html = 'Hello world') => {
    const doc = createThortiqDoc();
    ensureDocumentRoot(doc);
    const nodeId = createNodeId();
    upsertNodeRecord(doc, {
      id: nodeId,
      html,
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
      initialHtml: html,
      typographyClassName: 'thq-node-text'
    });
    adapter.setHtml(html);
    await flushMicrotasks();
    const editorEl = container.querySelector('[data-lexical-editor="true"]');
    if (!(editorEl instanceof HTMLElement)) {
      throw new Error('Adapter failed to mount Lexical root');
    }
    return {adapter, container, unmount, doc, nodeId};
  };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps caret offset stable across successive html synchronisations', async () => {
    const {adapter, container, unmount} = await setup();

    adapter.setSelection(3);
    await flushMicrotasks();
    const initialOffset = adapter.getSelectionOffset();

    adapter.setHtml(adapter.getHtml());
    await flushMicrotasks();
    const afterFirst = adapter.getSelectionOffset();

    adapter.setHtml(adapter.getHtml());
    await flushMicrotasks();
    const afterSecond = adapter.getSelectionOffset();

    expect(initialOffset).toBe(3);
    expect(afterFirst).toBe(3);
    expect(afterSecond).toBe(3);

    unmount();
    adapter.destroy();
    container.remove();
  });

  it('writes XmlText updates with LOCAL_ORIGIN for local edits', async () => {
    const {adapter, container, unmount, doc, nodeId} = await setup();
    const xml = getOrCreateNodeXml(doc, nodeId);
    const origins: Array<unknown> = [];
    const observer = (event: Y.YTextEvent) => {
      const tx = Reflect.get(event as unknown as Record<string, unknown>, 'transaction');
      const origin = typeof tx === 'object' && tx !== null ? Reflect.get(tx as Record<string, unknown>, 'origin') : null;
      origins.push(origin ?? null);
    };
    xml.observe(observer);
    origins.length = 0; // skip initial sync

    adapter.setHtml('<p>Updated</p>');
    await flushMicrotasks();

    expect(origins).toHaveLength(1);
    expect(origins[0]).toBe(LOCAL_ORIGIN);

    xml.unobserve(observer);
    unmount();
    adapter.destroy();
    container.remove();
  });

  it('applies remote XmlText updates without shifting caret', async () => {
    const {adapter, container, unmount, doc, nodeId} = await setup('Remote base');
    const xml = getOrCreateNodeXml(doc, nodeId);
    adapter.setSelection(4);
    await flushMicrotasks();

    doc.transact(() => {
      xml.delete(0, xml.length);
      xml.insert(0, '<p>Remote edit</p>');
    }, REMOTE_ORIGIN);
    await flushMicrotasks();

    expect(adapter.getHtml()).toBe('Remote edit');
    expect(adapter.getSelectionOffset()).toBeLessThanOrEqual(4);

    unmount();
    adapter.destroy();
    container.remove();
  });
});



