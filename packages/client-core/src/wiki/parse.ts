/**
 * Wiki parse/serialize
 *
 * Pure helpers to parse wiki link markup from plain text and to serialize
 * programmatic structures back to wiki notation. No side-effects or Yjs ops.
 */
import type {WikiLinkToken} from './types';

// Matches [[Display|Target]] or [[Target]] (no nested brackets)
const WIKI_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export const parseWikiLinks = (text: string): readonly WikiLinkToken[] => {
  const tokens: WikiLinkToken[] = [];
  if (!text || text.length === 0) {
    return tokens;
  }

  for (const match of text.matchAll(WIKI_PATTERN)) {
    const full = match[0] ?? '';
    const a = match.index ?? -1;
    if (a < 0) continue;
    const b = a + full.length;
    const first = (match[1] ?? '').trim();
    const second = (match[2] ?? '').trim();

    const hasDisplay = second.length > 0;
    const display = hasDisplay ? first : first; // if single part, display == target text
    const targetText = hasDisplay ? second : first;

    tokens.push({start: a, end: b, raw: full, display, targetText});
  }
  return tokens;
};

export const serializeWikiLink = (display: string, targetText: string): string => {
  const d = display.trim();
  const t = targetText.trim();
  if (d.length === 0 && t.length === 0) return '[[ ]]';
  if (d.length === 0 || d === t) return `[[${t}]]`;
  return `[[${d}|${t}]]`;
};

export interface ReplaceResult {
  readonly text: string;
  readonly replaced: number;
}

// Replace wiki tokens using a mapper without changing non-wiki text.
export const replaceWikiLinks = (
  text: string,
  mapper: (token: WikiLinkToken) => string
): ReplaceResult => {
  const tokens = parseWikiLinks(text);
  if (tokens.length === 0) return {text, replaced: 0};

  let out = '';
  let cursor = 0;
  tokens.forEach((tok) => {
    if (tok.start > cursor) {
      out += text.slice(cursor, tok.start);
    }
    out += mapper(tok);
    cursor = tok.end;
  });
  if (cursor < text.length) {
    out += text.slice(cursor);
  }
  return {text: out, replaced: tokens.length};
};

