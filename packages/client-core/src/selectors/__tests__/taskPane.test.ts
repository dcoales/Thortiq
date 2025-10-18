import { describe, it, expect } from "vitest";
import { createOutlineDoc } from "../../doc/transactions";
import { addEdge } from "../../doc/edges";
import { createNode, updateNodeMetadata } from "../../doc/nodes";
import { buildTaskPaneRows } from "../taskPane";
import type { OutlineSnapshot } from "../../types";
import { createOutlineSnapshot } from "../../doc/snapshots";

describe("taskPane selector", () => {
  it("groups Overdue/Today/NextSevenDays/Later/Undated and creates 7 day headers", () => {
    const outline = createOutlineDoc();
    const base = new Date(Date.UTC(2024, 2, 10, 0, 0, 0, 0));
    const iso = (d: Date) => d.toISOString();
    const d = (offset: number) => new Date(Date.UTC(2024, 2, 10 + offset, 0, 0, 0, 0));

    const mk = (isoDue?: string) => {
      const nodeId = createNode(outline, { text: "task" });
      addEdge(outline, { parentNodeId: null, childNodeId: nodeId });
      updateNodeMetadata(outline, nodeId, { todo: { done: false, dueDate: isoDue } });
      return nodeId;
    };

    mk(iso(d(-1))); // overdue
    mk(iso(d(0))); // today
    mk(iso(d(1))); // next seven
    mk(iso(d(6))); // next seven
    mk(iso(d(8))); // later
    mk(undefined); // undated

    const snapshot = createOutlineSnapshot(outline) as OutlineSnapshot;
    const { rows } = buildTaskPaneRows(snapshot, { showCompleted: true, today: base, includeEmptyNextSevenDaysDays: true, outline });

    const hasSection = (name: "Overdue" | "Today" | "NextSevenDays" | "Later" | "Undated") => rows.some((r) => r.kind === "sectionHeader" && r.section === name);
    expect(hasSection("Overdue")).toBe(true);
    expect(hasSection("Today")).toBe(true);
    expect(hasSection("NextSevenDays")).toBe(true);
    expect(hasSection("Later")).toBe(true);
    expect(hasSection("Undated")).toBe(true);

    const nextSevenDayHeaders = rows.filter((r) => r.kind === "dayHeader" && r.section === "NextSevenDays");
    expect(nextSevenDayHeaders.length).toBeGreaterThanOrEqual(7);
  });
});



