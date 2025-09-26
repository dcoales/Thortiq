/**
 * Wiki trigger detection
 *
 * Pure helper to find an active wiki trigger in a text buffer based on caret
 * position. It returns the index after the opening `[[` and the current query
 * between the brackets up to the caret. It ignores closed links.
 */

export interface WikiTriggerMatch {
  readonly start: number; // index of first character after `[[`
  readonly end: number; // caret index where detection was performed
  readonly query: string; // raw query text between brackets
}

export const findActiveWikiTrigger = (text: string, caretIndex: number): WikiTriggerMatch | null => {
  const caret = Math.max(0, Math.min(caretIndex, text.length));
  // Look back for the last opening `[[` before caret
  const before = text.slice(0, caret);
  const openIndex = before.lastIndexOf('[[');
  if (openIndex < 0) return null;
  // Ensure there is no closing `]]` between the opening and caret
  const between = before.slice(openIndex + 2);
  if (between.includes(']]')) return null;
  return {start: openIndex + 2, end: caret, query: between};
};

