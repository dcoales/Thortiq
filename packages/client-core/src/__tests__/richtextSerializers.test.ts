import {plainTextToRichTextDoc, richTextDocToHtml, richTextDocToPlainText, htmlToRichTextDoc} from '../richtext/serializers';
import {richTextSchema} from '../richtext/schema';

describe('rich text serializers', () => {
  it('round-trips plain text with newlines', () => {
    const text = 'Line one\nLine two';
    const doc = plainTextToRichTextDoc(text);
    expect(richTextDocToPlainText(doc)).toBe(text);
  });

  it('serialises and parses formatting marks', () => {
    const paragraph = richTextSchema.nodes.paragraph.create({}, [
      richTextSchema.text('Bold', [richTextSchema.marks.strong.create()]),
      richTextSchema.text(' '),
      richTextSchema.text('Link', [
        richTextSchema.marks.link.create({
          href: 'https://example.com',
          id: 'link-1',
          openInNewTab: true
        }),
        richTextSchema.marks.tag.create({
          id: 'tag-12',
          label: 'Project',
          kind: 'hash'
        })
      ])
    ]);

    const doc = richTextSchema.nodes.doc.create(null, [paragraph]);
    const html = richTextDocToHtml(doc);
    expect(html).toContain('data-thortiq-mark="tag"');
    expect(html).toContain('href="https://example.com"');

    const parsed = htmlToRichTextDoc(html);
    const parsedParagraph = parsed.child(0);
    const linkNode = parsedParagraph.child(2);
    const linkMark = linkNode.marks.find((mark) => mark.type === richTextSchema.marks.link);
    expect(linkMark?.attrs.href).toBe('https://example.com');
    expect(linkMark?.attrs.openInNewTab).toBe(true);

    const tagMark = linkNode.marks.find((mark) => mark.type === richTextSchema.marks.tag);
    expect(tagMark?.attrs.id).toBe('tag-12');
    expect(tagMark?.attrs.label).toBe('Project');
  });

  it('parses date markup from HTML', () => {
    const html = '<p><time data-thortiq-mark="date" data-id="date-1" datetime="2024-02-03" data-display="Feb 3, 2024">Feb 3, 2024</time></p>';
    const doc = htmlToRichTextDoc(html);
    const paragraph = doc.child(0);
    const dateNode = paragraph.child(0);
    const dateMark = dateNode.marks.find((mark) => mark.type === richTextSchema.marks.date);
    expect(dateMark?.attrs.id).toBe('date-1');
    expect(dateMark?.attrs.iso).toBe('2024-02-03');
    expect(dateMark?.attrs.display).toBe('Feb 3, 2024');
  });

  it('round-trips wiki link metadata', () => {
    const wikiMark = richTextSchema.marks.wikiLink.create({
      targetId: 'node-42',
      displayText: 'See details'
    });
    const doc = richTextSchema.nodes.doc.create(null, [
      richTextSchema.nodes.paragraph.create({}, [richTextSchema.text('See details', [wikiMark])])
    ]);

    const html = richTextDocToHtml(doc);
    expect(html).toContain('data-target-id="node-42"');

    const parsed = htmlToRichTextDoc(html);
    const parsedMark = parsed.child(0).child(0).marks.find((mark) => mark.type === richTextSchema.marks.wikiLink);
    expect(parsedMark?.attrs.targetId).toBe('node-42');
    expect(parsedMark?.attrs.displayText).toBe('See details');
  });
});
