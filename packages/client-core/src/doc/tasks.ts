import { getNodeSnapshot, getNodeTextFragment, updateDateMark, updateNodeMetadata, withTransaction } from "./index";
import type { OutlineDoc } from "../types";
import type { NodeId } from "../ids";

/**
 * Returns the due date for a task as a Date, based on metadata.todo.dueDate if present,
 * otherwise the first inline date mark in the node. Returns null when no date is found.
 */
export const getTaskDueDate = (outline: OutlineDoc, nodeId: NodeId): Date | null => {
  const snapshot = getNodeSnapshot(outline, nodeId);
  const metaDue = snapshot.metadata.todo?.dueDate ?? null;
  if (typeof metaDue === "string") {
    const parsed = Date.parse(metaDue);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed);
    }
  }
  for (const span of snapshot.inlineContent) {
    for (const mark of span.marks) {
      if (mark.type !== "date") {
        continue;
      }
      const attrs = mark.attrs as { readonly date?: unknown };
      const iso = typeof attrs.date === "string" ? attrs.date : null;
      if (iso) {
        const parsed = Date.parse(iso);
        if (!Number.isNaN(parsed)) {
          return new Date(parsed);
        }
      }
    }
  }
  return null;
};

/**
 * Sets the task due date. If there is an inline date mark, it will be updated via updateDateMark.
 * Otherwise, metadata.todo.dueDate is set. All mutations occur inside a single transaction.
 */
export const setTaskDueDate = (
  outline: OutlineDoc,
  nodeId: NodeId,
  date: Date,
  origin?: unknown
): void => {
  withTransaction(
    outline,
    () => {
      // Try to update first inline date mark if present
      // Read fragment to ensure text indices are up-to-date for date mark update
      getNodeTextFragment(outline, nodeId);
      let updatedInline = false;
      // Minimal scan: find any span with a date mark from the snapshot then update that index
      const snapshot = getNodeSnapshot(outline, nodeId);
      const segmentIndex = snapshot.inlineContent.findIndex((s) => s.marks.some((m) => m.type === "date"));
      if (segmentIndex >= 0) {
        const displayText = snapshot.inlineContent[segmentIndex]?.text ?? date.toDateString();
        const hasTime = false;
        updateDateMark(outline, nodeId, segmentIndex, { date, displayText, hasTime }, origin);
        updatedInline = true;
      }

      // Ensure metadata.todo.dueDate matches even if inline updated
      updateNodeMetadata(outline, nodeId, {
        todo: {
          done: Boolean(getNodeSnapshot(outline, nodeId).metadata.todo?.done),
          dueDate: date.toISOString()
        }
      });

      // If no inline date existed, we rely on metadata only; inserting pills is handled elsewhere
      if (!updatedInline) {
        // no-op: metadata already updated
      }
    },
    origin
  );
};



