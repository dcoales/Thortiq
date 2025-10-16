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
 * Scan immediate children of the journal node for a date pill matching the given date (by day).
 * Returns the NodeId of the matching child entry or null if none found.
 */
export const findJournalEntryForDate = (
  outline: OutlineDoc,
  journalNodeId: NodeId,
  date: Date
): NodeId | null => {
  const datePart = isoDatePart(toUtcMidnightIso(date));
  const children = getChildEdgeIds(outline, journalNodeId);
  for (const edgeId of children) {
    const childNodeId = getEdgeSnapshot(outline, edgeId).childNodeId;
    const snapshot = getNodeSnapshot(outline, childNodeId);
    for (const span of snapshot.inlineContent) {
      for (const mark of span.marks) {
        if (mark.type !== "date") {
          continue;
        }
        const attrs = mark.attrs as { readonly date?: unknown };
        const iso = typeof attrs.date === "string" ? attrs.date : null;
        if (iso && isoDatePart(iso) === datePart) {
          return childNodeId;
        }
      }
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
  let createdNodeId: NodeId | null = null;
  withTransaction(
    outline,
    () => {
      const { nodeId } = addEdge(outline, { parentNodeId: journalNodeId, text: "", position: 0, origin });
      // Set text to display text and apply a date mark over it; keep a trailing space unmarked for typing comfort.
      const textWithSpace = `${displayText} `;
      setNodeText(outline, nodeId, textWithSpace, origin);
      const fragment = getNodeTextFragment(outline, nodeId);
      // Expect a single paragraph with a single Y.XmlText node
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


