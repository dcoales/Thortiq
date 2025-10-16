/**
 * Journal helpers: find/create daily entries under the Journal node.
 * All mutations occur inside Yjs transactions via withTransaction.
 */
import { addEdge, getChildEdgeIds, getEdgeSnapshot, getNodeSnapshot, getNodeTextFragment, setNodeText, withTransaction } from "./index";
import * as Y from "yjs";
import type { OutlineDoc } from "../types";
import type { NodeId } from "../ids";

/**
 * Normalizes a Date to UTC midnight and returns the ISO string (full ISO).
 */
const toUtcMidnightIso = (value: Date): string => {
  const normalized = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));
  return normalized.toISOString();
};

/**
 * Returns the YYYY-MM-DD portion of an ISO timestamp.
 */
const isoDatePart = (iso: string): string => iso.slice(0, 10);

/**
 * Month name helpers (English locale). Used for creating and ordering Month nodes.
 */
const MONTH_NAMES_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
] as const;

const monthIndexFromLabel = (label: string): number => {
  const normalized = label.trim().toLowerCase();
  let index = MONTH_NAMES_LONG.findIndex((m) => m.toLowerCase() === normalized);
  if (index >= 0) {
    return index;
  }
  // Also support common short month labels just in case (legacy or user-edited)
  const SHORT = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec"
  ];
  index = SHORT.findIndex((m) => m === normalized);
  return index >= 0 ? index : -1;
};

/**
 * Reads the first date mark on a node and returns its YYYY-MM-DD string, or null.
 */
const readNodeIsoDatePart = (outline: OutlineDoc, nodeId: NodeId): string | null => {
  const snapshot = getNodeSnapshot(outline, nodeId);
  for (const span of snapshot.inlineContent) {
    for (const mark of span.marks) {
      if (mark.type !== "date") {
        continue;
      }
      const attrs = mark.attrs as { readonly date?: unknown };
      const iso = typeof attrs.date === "string" ? attrs.date : null;
      if (iso) {
        return isoDatePart(iso);
      }
    }
  }
  return null;
};

/**
 * Scan journal hierarchy (Year → Month → Date) for a date pill matching the given date (by day).
 * Falls back to scanning immediate children of the journal node for legacy flat structures.
 * Returns the NodeId of the matching date entry or null if none found.
 */
export const findJournalEntryForDate = (
  outline: OutlineDoc,
  journalNodeId: NodeId,
  date: Date
): NodeId | null => {
  const datePart = isoDatePart(toUtcMidnightIso(date));

  // Preferred hierarchical search
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();

  const findChildByText = (parentNodeId: NodeId, textPredicate: (text: string) => boolean): NodeId | null => {
    const childEdges = getChildEdgeIds(outline, parentNodeId);
    for (const edgeId of childEdges) {
      const nodeId = getEdgeSnapshot(outline, edgeId).childNodeId;
      const snapshot = getNodeSnapshot(outline, nodeId);
      if (textPredicate(snapshot.text)) {
        return nodeId;
      }
    }
    return null;
  };

  const yearNodeId = findChildByText(journalNodeId, (text) => parseInt(text.trim(), 10) === year);
  if (yearNodeId) {
    const monthNodeId = findChildByText(yearNodeId, (text) => monthIndexFromLabel(text) === monthIndex);
    if (monthNodeId) {
      const dayChildren = getChildEdgeIds(outline, monthNodeId);
      for (const edgeId of dayChildren) {
        const nodeId = getEdgeSnapshot(outline, edgeId).childNodeId;
        const iso = readNodeIsoDatePart(outline, nodeId);
        if (iso && iso === datePart) {
          return nodeId;
        }
      }
    }
  }

  // Legacy flat structure fallback (immediate children of journal)
  const flatChildren = getChildEdgeIds(outline, journalNodeId);
  for (const edgeId of flatChildren) {
    const childNodeId = getEdgeSnapshot(outline, edgeId).childNodeId;
    const iso = readNodeIsoDatePart(outline, childNodeId);
    if (iso && iso === datePart) {
      return childNodeId;
    }
  }
  return null;
};

/**
 * Builds HTML for a date pill consistent with editor schema.
 */
export const buildDatePillHtml = (params: {
  readonly date: Date;
  readonly displayText: string;
  readonly hasTime?: boolean;
}): string => {
  const iso = params.date.toISOString();
  const hasTime = Boolean(params.hasTime);
  // Render markup aligned with editor schema date mark parseDOM (span[data-date]) and list renderer
  return `
<span data-date="true" data-date-value="${iso}" data-date-display="${escapeHtml(params.displayText)}" data-date-has-time="${hasTime ? "true" : "false"}" class="thortiq-date-pill">${escapeHtml(params.displayText)}</span>`;
};

// Minimal HTML escaping to avoid breaking attributes/text when injecting pill markup
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Ensures a journal entry exists for the given date as an immediate child of the journal node.
 * If missing, creates the child with the provided date pill HTML as its entire text.
 */
export const ensureJournalEntry = (
  outline: OutlineDoc,
  journalNodeId: NodeId,
  date: Date,
  displayText: string,
  origin?: unknown
): { entryNodeId: NodeId; didCreate: boolean } => {
  const existing = findJournalEntryForDate(outline, journalNodeId, date);
  if (existing) {
    return { entryNodeId: existing, didCreate: false };
  }

  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();
  const monthLabel = MONTH_NAMES_LONG[monthIndex];
  const targetDatePart = isoDatePart(toUtcMidnightIso(date));

  let createdNodeId: NodeId | null = null;

  const findInsertIndexForYear = (parentNodeId: NodeId, yearValue: number): number => {
    const childEdges = getChildEdgeIds(outline, parentNodeId);
    for (let i = 0; i < childEdges.length; i += 1) {
      const nodeId = getEdgeSnapshot(outline, childEdges[i]).childNodeId;
      const text = getNodeSnapshot(outline, nodeId).text.trim();
      const parsed = parseInt(text, 10);
      if (Number.isFinite(parsed) && parsed < yearValue) {
        return i; // Insert before smaller year to keep reverse (desc) order
      }
    }
    return childEdges.length; // Append at end if all existing are newer or unparsable
  };

  const findInsertIndexForMonth = (parentNodeId: NodeId, month: number): number => {
    const childEdges = getChildEdgeIds(outline, parentNodeId);
    for (let i = 0; i < childEdges.length; i += 1) {
      const nodeId = getEdgeSnapshot(outline, childEdges[i]).childNodeId;
      const label = getNodeSnapshot(outline, nodeId).text;
      const existing = monthIndexFromLabel(label);
      if (existing >= 0 && existing < month) {
        return i; // Insert before smaller month to keep reverse (desc) order
      }
    }
    return childEdges.length;
  };

  const findInsertIndexForDate = (parentNodeId: NodeId, isoDay: string): number => {
    const childEdges = getChildEdgeIds(outline, parentNodeId);
    for (let i = 0; i < childEdges.length; i += 1) {
      const nodeId = getEdgeSnapshot(outline, childEdges[i]).childNodeId;
      const existingIso = readNodeIsoDatePart(outline, nodeId);
      if (existingIso && existingIso < isoDay) {
        return i; // Insert before older day to keep reverse (desc) order
      }
    }
    return childEdges.length;
  };

  withTransaction(
    outline,
    () => {
      // Ensure Year node under Journal (reverse chronological by year)
      const journalChildren = getChildEdgeIds(outline, journalNodeId);
      let yearNodeId: NodeId | null = null;
      for (const edgeId of journalChildren) {
        const candidateId = getEdgeSnapshot(outline, edgeId).childNodeId;
        const text = getNodeSnapshot(outline, candidateId).text.trim();
        if (parseInt(text, 10) === year) {
          yearNodeId = candidateId;
          break;
        }
      }
      if (!yearNodeId) {
        const position = findInsertIndexForYear(journalNodeId, year);
        const { nodeId } = addEdge(outline, { parentNodeId: journalNodeId, text: String(year), position, origin });
        yearNodeId = nodeId;
      }

      // Ensure Month node under Year (reverse chronological by month within the same year)
      const yearChildren = getChildEdgeIds(outline, yearNodeId);
      let monthNodeId: NodeId | null = null;
      for (const edgeId of yearChildren) {
        const candidateId = getEdgeSnapshot(outline, edgeId).childNodeId;
        const label = getNodeSnapshot(outline, candidateId).text;
        if (monthIndexFromLabel(label) === monthIndex) {
          monthNodeId = candidateId;
          break;
        }
      }
      if (!monthNodeId) {
        const position = findInsertIndexForMonth(yearNodeId, monthIndex);
        const { nodeId } = addEdge(outline, { parentNodeId: yearNodeId, text: monthLabel, position, origin });
        monthNodeId = nodeId;
      }

      // Ensure Date entry under Month (reverse chronological by day within month)
      const existingDay = findJournalEntryForDate(outline, journalNodeId, date);
      if (existingDay) {
        createdNodeId = existingDay;
        return;
      }

      const dayPosition = findInsertIndexForDate(monthNodeId, targetDatePart);
      const { nodeId } = addEdge(outline, { parentNodeId: monthNodeId, text: "", position: dayPosition, origin });

      // Set text and apply the date mark; add trailing space for typing comfort
      const textWithSpace = `${displayText} `;
      setNodeText(outline, nodeId, textWithSpace, origin);
      const fragment = getNodeTextFragment(outline, nodeId);
      const firstChild = fragment.toArray()[0];
      if (firstChild instanceof Y.XmlElement) {
        const paraChildren = firstChild.toArray();
        const textNode = paraChildren.find((c) => c instanceof Y.XmlText) as Y.XmlText | undefined;
        if (textNode) {
          const iso = toUtcMidnightIso(date);
          const payload: Record<string, unknown> = {
            date: {
              date: iso,
              displayText,
              hasTime: false
            }
          };
          textNode.format(0, displayText.length, payload);
        }
      }
      createdNodeId = nodeId;
    },
    origin
  );

  if (createdNodeId === null) {
    throw new Error("Failed to create journal entry node");
  }
  return { entryNodeId: createdNodeId, didCreate: true };
};

/**
 * Ensures the first child exists under parent; if not, creates an empty child and returns its NodeId.
 */
export const ensureFirstChild = (
  outline: OutlineDoc,
  parentNodeId: NodeId,
  origin?: unknown
): NodeId => {
  const children = getChildEdgeIds(outline, parentNodeId);
  if (children.length > 0) {
    const firstEdgeId = children[0];
    return getEdgeSnapshot(outline, firstEdgeId).childNodeId;
  }
  let createdNodeId: NodeId | null = null;
  withTransaction(
    outline,
    () => {
      const { nodeId } = addEdge(outline, { parentNodeId, text: "", position: 0, origin });
      createdNodeId = nodeId;
    },
    origin
  );
  if (createdNodeId === null) {
    throw new Error("Failed to create first child node");
  }
  return createdNodeId;
};


