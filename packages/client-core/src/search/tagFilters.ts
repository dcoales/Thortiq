/**
 * Shared helpers for manipulating tag-based search filters. These utilities keep query string
 * handling consistent across platforms so toggling a tag pill leads to identical search input
 * semantics (docs/tags.md step 9).
 */

const TAG_FILTER_IDENTIFIER_PATTERN = /^[^\s()[\].:#"'\\]+$/u;

const escapeTagValue = (value: string): string => {
  return value.replace(/(["\\])/gu, "\\$1");
};

const formatTagFilterValue = (label: string): string => {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (TAG_FILTER_IDENTIFIER_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return `"${escapeTagValue(trimmed)}"`;
};

export const formatTagFilter = (label: string): string => {
  const value = formatTagFilterValue(label);
  return value.length === 0 ? "" : `tag:${value}`;
};

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
};

export interface ToggleTagFilterResult {
  readonly query: string;
  readonly removed: boolean;
}

export const toggleTagFilterInQuery = (query: string, label: string): ToggleTagFilterResult => {
  const filter = formatTagFilter(label);
  if (filter.length === 0) {
    return { query: query.trim(), removed: false };
  }

  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return { query: filter, removed: false };
  }

  const pattern = new RegExp(`(^|\\s)${escapeRegExp(filter)}(?=$|\\s)`, "u");
  if (pattern.test(trimmedQuery)) {
    const next = trimmedQuery.replace(pattern, (_match, leadingSpace) => (leadingSpace ?? "").trim());
    const normalised = next.replace(/\s+/gu, " ").trim();
    return { query: normalised, removed: true };
  }

  return {
    query: `${trimmedQuery} ${filter}`,
    removed: false
  };
};
