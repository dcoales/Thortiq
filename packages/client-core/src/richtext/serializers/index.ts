/**
 * Serializers bridge Thortiq rich text documents with HTML, JSON, and plain
 * text representations so every editor stays aligned with
 * docs/rich_text_editor_requirements.md.
 */
import {DOMParser as ProseMirrorDOMParser, DOMSerializer, Node as ProseMirrorNode} from 'prosemirror-model';

import {richTextSchema} from '../schema';

export type RichTextJSON = Record<string, unknown>;

const parser = ProseMirrorDOMParser.fromSchema(richTextSchema);
const serializer = DOMSerializer.fromSchema(richTextSchema);

const ensureDocument = (): Document | null => {
  if (typeof document !== 'undefined') {
    return document;
  }
  return null;
};

const createScratchContainer = (): HTMLElement | null => {
  const doc = ensureDocument();
  if (!doc) {
    return null;
  }
  return doc.createElement('div');
};

const fallbackPlainText = (html: string) => html.replace(/<[^>]+>/g, '');

export const createEmptyRichTextDoc = (): ProseMirrorNode =>
  richTextSchema.nodes.doc.createAndFill() ?? richTextSchema.nodes.doc.create(null, []);

export const plainTextToRichTextDoc = (text: string): ProseMirrorNode => {
  const lines = (text ?? '').split('\n');
  const paragraphs = lines.map((line) => {
    if (line.length === 0) {
      return richTextSchema.nodes.paragraph.create();
    }
    return richTextSchema.nodes.paragraph.create({}, [richTextSchema.text(line)]);
  });
  if (paragraphs.length === 0) {
    paragraphs.push(richTextSchema.nodes.paragraph.create());
  }
  return richTextSchema.nodes.doc.create(null, paragraphs);
};

export const richTextDocToPlainText = (doc: ProseMirrorNode): string => {
  const lines: string[] = [];
  doc.forEach((node) => {
    lines.push(node.textContent ?? '');
  });
  return lines.join('\n');
};

export const htmlToRichTextDoc = (html: string): ProseMirrorNode => {
  const container = createScratchContainer();
  if (!container) {
    return plainTextToRichTextDoc(fallbackPlainText(html));
  }
  container.innerHTML = html;
  const parsed = parser.parse(container);
  return parsed ?? createEmptyRichTextDoc();
};

export const richTextDocToHtml = (doc: ProseMirrorNode): string => {
  const docRef = ensureDocument();
  if (!docRef) {
    return richTextDocToPlainText(doc);
  }
  const fragment = serializer.serializeFragment(doc.content, {document: docRef});
  const container = docRef.createElement('div');
  container.appendChild(fragment);
  return container.innerHTML;
};

export const richTextDocToJSON = (doc: ProseMirrorNode): RichTextJSON => doc.toJSON() as RichTextJSON;

export const richTextJSONToDoc = (json: RichTextJSON | null | undefined): ProseMirrorNode => {
  if (!json) {
    return createEmptyRichTextDoc();
  }
  try {
    return richTextSchema.nodeFromJSON(json as unknown as Record<string, unknown>);
  } catch {
    return createEmptyRichTextDoc();
  }
};
