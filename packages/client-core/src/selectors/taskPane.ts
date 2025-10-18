import type { OutlineSnapshot } from "../types";
import type { EdgeId, NodeId } from "../ids";

export type TaskPaneSection = "Overdue" | "Today" | "NextSevenDays" | "Later" | "Undated";

export type TaskPaneRow =
  | {
      readonly kind: "sectionHeader";
      readonly key: string;
      readonly section: TaskPaneSection;
    }
  | {
      readonly kind: "dayHeader";
      readonly key: string;
      readonly section: TaskPaneSection;
      readonly dateKey: string; // YYYY-MM-DD (UTC)
      readonly label: string; // e.g., Wednesday, March 13, 2024
    }
  | {
      readonly kind: "task";
      readonly key: string;
      readonly section: TaskPaneSection;
      readonly edgeId: EdgeId;
      readonly canonicalEdgeId: EdgeId;
      readonly nodeId: NodeId;
      readonly dueDateIso: string | null; // full ISO if present
    };

export interface BuildTaskPaneRowsOptions {
  readonly showCompleted: boolean;
  readonly today?: Date; // For tests; defaults to current date (UTC-based day)
  readonly includeEmptyNextSevenDaysDays?: boolean; // default true
}

export interface TaskPaneRowsResult {
  readonly rows: readonly TaskPaneRow[];
}

const toUtcMidnight = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
const addDays = (date: Date, days: number): Date => {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return toUtcMidnight(d);
};
const isoDay = (date: Date): string => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)).toISOString().slice(0, 10);

const formatDayHeader = (date: Date): string =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);

const getDueDateFromSnapshot = (snapshot: OutlineSnapshot, nodeId: NodeId): { iso: string | null; date: Date | null } => {
  const node = snapshot.nodes.get(nodeId);
  if (!node) {
    return { iso: null, date: null };
  }
  const metaDue = node.metadata.todo?.dueDate ?? null;
  if (typeof metaDue === "string") {
    const parsed = Date.parse(metaDue);
    if (!Number.isNaN(parsed)) {
      return { iso: new Date(parsed).toISOString(), date: new Date(parsed) };
    }
  }
  for (const span of node.inlineContent) {
    for (const mark of span.marks) {
      if (mark.type !== "date") {
        continue;
      }
      const attrs = mark.attrs as { readonly date?: unknown };
      const iso = typeof attrs.date === "string" ? attrs.date : null;
      if (iso) {
        const parsed = Date.parse(iso);
        if (!Number.isNaN(parsed)) {
          return { iso: new Date(parsed).toISOString(), date: new Date(parsed) };
        }
      }
    }
  }
  // Fallback for serialized pill HTML present in text
  const text = node.text ?? "";
  const match = /data-date-value="([^"]+)"/u.exec(text);
  if (match && typeof match[1] === "string") {
    const parsed = Date.parse(match[1]);
    if (!Number.isNaN(parsed)) {
      const d = new Date(parsed);
      return { iso: d.toISOString(), date: d };
    }
  }
  return { iso: null, date: null };
};

export const buildTaskPaneRows = (
  snapshot: OutlineSnapshot,
  options: BuildTaskPaneRowsOptions
): TaskPaneRowsResult => {
  const showCompleted = options.showCompleted;
  const includeEmptyNextSeven = options.includeEmptyNextSevenDaysDays ?? true;
  const todayBase = toUtcMidnight(options.today ?? new Date());
  const tomorrow = addDays(todayBase, 1);
  const sevenDays = Array.from({ length: 7 }, (_, i) => addDays(tomorrow, i));

  type DayBucket = Map<string, { date: Date; items: { edgeId: EdgeId; canonicalEdgeId: EdgeId; nodeId: NodeId; iso: string | null }[] }>;

  const overdue: DayBucket = new Map();
  const todayItems: { edgeId: EdgeId; canonicalEdgeId: EdgeId; nodeId: NodeId; iso: string | null }[] = [];
  const nextSeven: DayBucket = new Map();
  const later: DayBucket = new Map();
  const undated: { edgeId: EdgeId; canonicalEdgeId: EdgeId; nodeId: NodeId; iso: string | null }[] = [];

  const todayKey = isoDay(todayBase);
  const tomorrowKey = isoDay(tomorrow);
  const lastSevenKey = isoDay(addDays(tomorrow, 6));

  snapshot.edges.forEach((edge) => {
    // Only index canonical edges (exclude mirror instances)
    if (edge.id !== edge.canonicalEdgeId) {
      return;
    }
    const node = snapshot.nodes.get(edge.childNodeId);
    if (!node) {
      return;
    }
    const isTask = Boolean(node.metadata.todo);
    if (!isTask) {
      return;
    }
    if (!showCompleted && node.metadata.todo && node.metadata.todo.done) {
      return;
    }

    const { iso, date } = getDueDateFromSnapshot(snapshot, node.id);
    if (!date) {
      undated.push({ edgeId: edge.id, canonicalEdgeId: edge.canonicalEdgeId, nodeId: node.id, iso: null });
      return;
    }
    const dueKey = isoDay(date);
    const entry = { edgeId: edge.id, canonicalEdgeId: edge.canonicalEdgeId, nodeId: node.id, iso };

    if (dueKey < todayKey) {
      const existing = overdue.get(dueKey) ?? { date: toUtcMidnight(date), items: [] };
      existing.items.push(entry);
      overdue.set(dueKey, existing);
    } else if (dueKey === todayKey) {
      todayItems.push(entry);
    } else if (dueKey >= tomorrowKey && dueKey <= lastSevenKey) {
      const existing = nextSeven.get(dueKey) ?? { date: toUtcMidnight(date), items: [] };
      existing.items.push(entry);
      nextSeven.set(dueKey, existing);
    } else {
      const existing = later.get(dueKey) ?? { date: toUtcMidnight(date), items: [] };
      existing.items.push(entry);
      later.set(dueKey, existing);
    }
  });

  // Ensure seven day headers are present
  if (includeEmptyNextSeven) {
    for (const d of sevenDays) {
      const key = isoDay(d);
      if (!nextSeven.has(key)) {
        nextSeven.set(key, { date: d, items: [] });
      }
    }
  }

  const rows: TaskPaneRow[] = [];

  const pushSection = (section: TaskPaneSection) => {
    rows.push({ kind: "sectionHeader", key: `section:${section}`, section });
  };

  const pushDayBuckets = (section: TaskPaneSection, bucket: DayBucket, sortDesc = false) => {
    const entries = Array.from(bucket.entries()).sort(([a], [b]) => (sortDesc ? (a > b ? -1 : a < b ? 1 : 0) : a < b ? -1 : a > b ? 1 : 0));
    for (const [key, value] of entries) {
      rows.push({ kind: "dayHeader", key: `day:${section}:${key}`, section, dateKey: key, label: formatDayHeader(value.date) });
      for (const item of value.items) {
        rows.push({ kind: "task", key: `task:${item.edgeId}`, section, edgeId: item.edgeId, canonicalEdgeId: item.canonicalEdgeId, nodeId: item.nodeId, dueDateIso: item.iso });
      }
    }
  };

  // Overdue (only if any)
  if (overdue.size > 0) {
    pushSection("Overdue");
    // Overdue groups by day (ascending by day makes sense or descending? Spec doesn't dictate; choose ascending)
    pushDayBuckets("Overdue", overdue, false);
  }

  // Today (always include section; may contain zero tasks)
  pushSection("Today");
  for (const item of todayItems) {
    rows.push({ kind: "task", key: `task:${item.edgeId}`, section: "Today", edgeId: item.edgeId, canonicalEdgeId: item.canonicalEdgeId, nodeId: item.nodeId, dueDateIso: item.iso });
  }

  // Next seven days (always include section, include day headers even if empty)
  pushSection("NextSevenDays");
  pushDayBuckets("NextSevenDays", nextSeven, false);

  // Later (always include section; may contain zero day buckets)
  pushSection("Later");
  pushDayBuckets("Later", later, false);

  // Undated (always include section; may contain zero tasks)
  pushSection("Undated");
  for (const item of undated) {
    rows.push({ kind: "task", key: `task:${item.edgeId}`, section: "Undated", edgeId: item.edgeId, canonicalEdgeId: item.canonicalEdgeId, nodeId: item.nodeId, dueDateIso: null });
  }

  return { rows };
};



