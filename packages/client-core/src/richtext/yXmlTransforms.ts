import * as Y from 'yjs';

const getDocument = (): Document | null => {
  if (typeof document !== 'undefined') {
    return document;
  }
  return null;
};

const createParagraph = (text: string): Y.XmlElement => {
  const paragraph = new Y.XmlElement('p');
  if (text.length > 0) {
    const textNode = new Y.XmlText();
    textNode.insert(0, text);
    paragraph.insert(0, [textNode]);
  }
  return paragraph;
};

const convertDomNode = (node: Node): Y.XmlElement | Y.XmlText | null => {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    const yElement = new Y.XmlElement(element.tagName.toLowerCase());
    for (const name of element.getAttributeNames()) {
      const value = element.getAttribute(name);
      if (value !== null) {
        yElement.setAttribute(name, value);
      }
    }

    const children: Array<Y.XmlElement | Y.XmlText> = [];
    element.childNodes.forEach((child) => {
      const converted = convertDomNode(child);
      if (converted) {
        children.push(converted);
      }
    });

    if (children.length > 0) {
      yElement.insert(0, children);
    }

    return yElement;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const textNode = new Y.XmlText();
    const content = node.nodeValue ?? '';
    if (content.length > 0) {
      textNode.insert(0, content);
    }
    return textNode;
  }

  return null;
};

const fallbackFromHtml = (fragment: Y.XmlFragment, html: string) => {
  const stripped = html.replace(/<[^>]+>/g, '');
  fragment.insert(0, [createParagraph(stripped.trim())]);
};

export const replaceFragmentFromHtml = (
  fragment: Y.XmlFragment,
  html: string
): void => {
  fragment.delete(0, fragment.length);

  if (html.trim().length === 0) {
    fragment.insert(0, [createParagraph('')]);
    return;
  }

  const doc = getDocument();
  if (!doc) {
    fallbackFromHtml(fragment, html);
    return;
  }

  const container = doc.createElement('div');
  container.innerHTML = html;

  const nodes: Array<Y.XmlElement | Y.XmlText> = [];
  container.childNodes.forEach((node) => {
    const converted = convertDomNode(node);
    if (converted) {
      nodes.push(converted);
    }
  });

  if (nodes.length === 0) {
    nodes.push(createParagraph(''));
  }

  const normalized: Y.XmlElement[] = nodes.map((entry) => {
    if (entry instanceof Y.XmlElement) {
      return entry;
    }
    const paragraph = new Y.XmlElement('p');
    paragraph.insert(0, [entry]);
    return paragraph;
  });

  fragment.insert(0, normalized);
};
