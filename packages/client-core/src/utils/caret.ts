/**
 * caret.ts
 *
 * Responsibility: Shared DOM caret helpers used by both the rich text adapter
 * and the outline overlay to translate between pointer coordinates, text
 * offsets, and DOM Ranges without triggering layout mutations.
 */
import type {AdapterPoint} from '../richtext/adapter';

type CaretPositionLike = {offsetNode: Node; offset: number};
type DocumentWithOptionalCaret = Document & Partial<{
  caretRangeFromPoint: (x: number, y: number) => Range | null;
  caretPositionFromPoint: (x: number, y: number) => CaretPositionLike | null;
}>;

export const caretRangeFromPoint = (x: number, y: number): Range | null => {
  const doc = document as DocumentWithOptionalCaret;
  const range = typeof doc.caretRangeFromPoint === 'function'
    ? doc.caretRangeFromPoint(x, y)
    : null;
  if (range) {
    return range;
  }
  const position = typeof doc.caretPositionFromPoint === 'function'
    ? doc.caretPositionFromPoint(x, y)
    : null;
  if (position) {
    const fallbackRange = document.createRange();
    fallbackRange.setStart(position.offsetNode, position.offset);
    fallbackRange.collapse(true);
    return fallbackRange;
  }
  return null;
};

export const textOffsetFromRange = (root: HTMLElement, range: Range): number => {
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

export const rangeFromTextOffset = (root: HTMLElement, targetOffset: number): Range | null => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let remaining = targetOffset;
  let node: Node | null = walker.nextNode();
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(node, Math.max(0, remaining));
      range.collapse(true);
      return range;
    }
    remaining -= len;
    node = walker.nextNode();
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  return range;
};

export const getCaretOffsetFromPoint = (root: HTMLElement, point: AdapterPoint): number | null => {
  const range = caretRangeFromPoint(point.x, point.y);
  if (!range) {
    return null;
  }
  const ancestor = range.startContainer instanceof Element
    ? range.startContainer
    : range.startContainer.parentElement;
  if (ancestor && !root.contains(ancestor)) {
    return null;
  }
  return textOffsetFromRange(root, range);
};
