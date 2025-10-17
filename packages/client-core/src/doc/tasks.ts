import { getNodeSnapshot, getNodeTextFragment, updateDateMark, updateNodeMetadata, withTransaction } from "./index";
import * as Y from "yjs";
import { getUserSetting } from "../preferences/userSettings";
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
  // Fallback: parse embedded pill markup if the node text contains serialized HTML
  const text = snapshot.text ?? "";
  const match = /data-date-value="([^"]+)"/u.exec(text);
  if (match && typeof match[1] === "string") {
    const parsed = Date.parse(match[1]);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed);
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
        // Update pill to new date while preserving the original display format and hasTime flag
        const segment = snapshot.inlineContent[segmentIndex];
        const previousText = segment?.text ?? date.toDateString();
        const dateMark = segment?.marks.find((m) => m.type === "date") ?? null;
        const hasTime = String((dateMark?.attrs as { readonly hasTime?: unknown } | undefined)?.hasTime) === "true";

        const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
        const WEEKDAY_LONG = [
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday"
        ] as const;
        const MONTH_SHORT = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec"
        ] as const;
        const MONTH_LONG = [
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

        const contains = (candidates: readonly string[]): boolean =>
          candidates.some((token) => previousText.includes(token));

        const includesWeekdayLong = WEEKDAY_LONG.some((d) => previousText.startsWith(d));
        const includesWeekdayShort = WEEKDAY_SHORT.some((d) => previousText.startsWith(d));
        const includesMonthLong = contains(MONTH_LONG);
        const includesMonthShort = contains(MONTH_SHORT);
        const includesYear = /\b\d{4}\b/u.test(previousText);

        const options: Intl.DateTimeFormatOptions = {
          weekday: includesWeekdayLong ? "long" : includesWeekdayShort ? "short" : undefined,
          month: includesMonthLong ? "long" : includesMonthShort ? "short" : undefined,
          day: "numeric",
          year: includesYear ? "numeric" : undefined,
          hour: hasTime ? "numeric" : undefined,
          minute: hasTime ? "2-digit" : undefined,
          hour12: hasTime ? true : undefined,
          timeZone: "UTC"
        };
        const displayText = new Intl.DateTimeFormat("en-US", options).format(date);

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

      // If no inline date existed, insert a date pill at the start using user format
      if (!updatedInline) {
        const fragment = getNodeTextFragment(outline, nodeId);
        const paragraph = (fragment.get(0) as Y.XmlElement | undefined) ?? null;
        if (paragraph) {
          const userFormat = (getUserSetting(outline, "datePillFormat") as string) || "ddd, MMM D";
          const hasTime = false; // Tasks Pane reschedule sets date-only
          // Minimal mapping similar to editor: weekday short when ddd, month short when MMM, day numeric when D
          const options: Intl.DateTimeFormatOptions = {
            weekday: userFormat.includes("ddd") ? "short" : undefined,
            month: userFormat.includes("MMM") ? "short" : undefined,
            day: userFormat.includes("D") ? "numeric" : undefined
          };
          const displayText = new Intl.DateTimeFormat("en-US", options).format(date);

          const dateNode = new Y.XmlText();
          dateNode.insert(0, displayText, {
            date: {
              date: date.toISOString(),
              displayText,
              hasTime
            }
          });
          // Insert at start of paragraph
          paragraph.insert(0, [dateNode]);
          // Ensure a space after the pill for readability if needed
          const nextSibling = paragraph.get(1) as Y.XmlText | Y.XmlElement | undefined;
          const needsSpace = (() => {
            if (!nextSibling) return true;
            if (nextSibling instanceof Y.XmlText) {
              const deltas = nextSibling.toDelta() as Array<{ insert: unknown }>;
              const first = deltas.find((d) => typeof d.insert === "string");
              const text = typeof first?.insert === "string" ? first.insert : "";
              return text.length === 0 || !/^[\s]/u.test(text);
            }
            return true;
          })();
          if (needsSpace) {
            const spaceNode = new Y.XmlText();
            spaceNode.insert(0, " ");
            paragraph.insert(1, [spaceNode]);
          }
        }
      }
    },
    origin
  );
};


/**
 * Sets the due date for multiple tasks in a single transaction.
 * Mirrors the logic of setTaskDueDate for each node, but batches all
 * mutations to satisfy unified history and transaction rules.
 */
export const setTasksDueDate = (
  outline: OutlineDoc,
  nodeIds: readonly NodeId[],
  date: Date,
  origin?: unknown
): void => {
  withTransaction(
    outline,
    () => {
      for (const nodeId of nodeIds) {
        // Ensure text fragment is up-to-date for mark index computations
        getNodeTextFragment(outline, nodeId);
        let updatedInline = false;
        const snapshot = getNodeSnapshot(outline, nodeId);
        const segmentIndex = snapshot.inlineContent.findIndex((s) => s.marks.some((m) => m.type === "date"));
        if (segmentIndex >= 0) {
          const segment = snapshot.inlineContent[segmentIndex];
          const previousText = segment?.text ?? date.toDateString();
          const dateMark = segment?.marks.find((m) => m.type === "date") ?? null;
          const hasTime = String((dateMark?.attrs as { readonly hasTime?: unknown } | undefined)?.hasTime) === "true";

          const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
          const WEEKDAY_LONG = [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday"
          ] as const;
          const MONTH_SHORT = [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec"
          ] as const;
          const MONTH_LONG = [
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

          const contains = (candidates: readonly string[]): boolean =>
            candidates.some((token) => previousText.includes(token));

          const includesWeekdayLong = WEEKDAY_LONG.some((d) => previousText.startsWith(d));
          const includesWeekdayShort = WEEKDAY_SHORT.some((d) => previousText.startsWith(d));
          const includesMonthLong = contains(MONTH_LONG);
          const includesMonthShort = contains(MONTH_SHORT);
          const includesYear = /\b\d{4}\b/u.test(previousText);

          const options: Intl.DateTimeFormatOptions = {
            weekday: includesWeekdayLong ? "long" : includesWeekdayShort ? "short" : undefined,
            month: includesMonthLong ? "long" : includesMonthShort ? "short" : undefined,
            day: "numeric",
            year: includesYear ? "numeric" : undefined,
            hour: hasTime ? "numeric" : undefined,
            minute: hasTime ? "2-digit" : undefined,
            hour12: hasTime ? true : undefined,
            timeZone: "UTC"
          };
          const displayText = new Intl.DateTimeFormat("en-US", options).format(date);

          updateDateMark(outline, nodeId, segmentIndex, { date, displayText, hasTime }, origin);
          updatedInline = true;
        }

        // Sync metadata regardless of inline update
        updateNodeMetadata(outline, nodeId, {
          todo: {
            done: Boolean(getNodeSnapshot(outline, nodeId).metadata.todo?.done),
            dueDate: date.toISOString()
          }
        });

        if (!updatedInline) {
          const fragment = getNodeTextFragment(outline, nodeId);
          const paragraph = (fragment.get(0) as Y.XmlElement | undefined) ?? null;
          if (paragraph) {
            const userFormat = (getUserSetting(outline, "datePillFormat") as string) || "ddd, MMM D";
            const hasTime = false;
            const options: Intl.DateTimeFormatOptions = {
              weekday: userFormat.includes("ddd") ? "short" : undefined,
              month: userFormat.includes("MMM") ? "short" : undefined,
              day: userFormat.includes("D") ? "numeric" : undefined
            };
            const displayText = new Intl.DateTimeFormat("en-US", options).format(date);

            const dateNode = new Y.XmlText();
            dateNode.insert(0, displayText, {
              date: {
                date: date.toISOString(),
                displayText,
                hasTime
              }
            });
            paragraph.insert(0, [dateNode]);

            const nextSibling = paragraph.get(1) as Y.XmlText | Y.XmlElement | undefined;
            const needsSpace = (() => {
              if (!nextSibling) return true;
              if (nextSibling instanceof Y.XmlText) {
                const deltas = nextSibling.toDelta() as Array<{ insert: unknown }>;
                const first = deltas.find((d) => typeof d.insert === "string");
                const text = typeof first?.insert === "string" ? first.insert : "";
                return text.length === 0 || !/^[\s]/u.test(text);
              }
              return true;
            })();
            if (needsSpace) {
              const spaceNode = new Y.XmlText();
              spaceNode.insert(0, " ");
              paragraph.insert(1, [spaceNode]);
            }
          }
        }
      }
    },
    origin
  );
};



