import { describe, expect, it } from "vitest";

import { buildOutlineForest, buildPaneRows, createMirrorEdge, createOutlineSnapshot } from "./index";

import { createOutlineDoc } from "./doc/transactions";
import { addEdge } from "./doc/edges";
import { createNode, updateNodeMetadata, setNodeText } from "./doc/nodes";
import { buildTaskPaneRows } from "./selectors/taskPane";
import { buildDatePillHtml } from "./doc/journal";


describe("outline selectors", () => {
  it("builds a nested tree from the snapshot", () => {
    const outline = createOutlineDoc();
    const rootNode = createNode(outline, { text: "root" });
    const child = addEdge(outline, { parentNodeId: null, childNodeId: rootNode });
    const childNode = addEdge(outline, { parentNodeId: rootNode, text: "child" });
    addEdge(outline, { parentNodeId: childNode.nodeId, text: "grandchild" });

    const snapshot = createOutlineSnapshot(outline);
    const forest = buildOutlineForest(snapshot);

    expect(forest).toHaveLength(1);
    const [tree] = forest;
    expect(tree.edge.id).toBe(child.edgeId);
    expect(tree.node.text).toBe("root");
    expect(tree.children[0].node.text).toBe("child");
    expect(tree.children[0].children[0].node.text).toBe("grandchild");
  });

  it("projects unique row edge ids for mirror children while sharing canonical edges", () => {
    const outline = createOutlineDoc();
    const root = addEdge(outline, { parentNodeId: null, text: "Original root" });
    const mirrorSource = addEdge(outline, { parentNodeId: root.nodeId, text: "Mirror source" });
    const nested = addEdge(outline, { parentNodeId: mirrorSource.nodeId, text: "Nested child" });

    const mirror = createMirrorEdge({
      outline,
      mirrorNodeId: mirrorSource.nodeId,
      insertParentNodeId: null,
      insertIndex: 1
    });

    expect(mirror).not.toBeNull();

    const snapshot = createOutlineSnapshot(outline);
    const paneRows = buildPaneRows(snapshot, {
      rootEdgeId: null,
      collapsedEdgeIds: [],
      search: undefined,
      focusPathEdgeIds: undefined
    });

    const nestedRows = paneRows.rows.filter((row) => row.edge.canonicalEdgeId === nested.edgeId);
    expect(nestedRows).toHaveLength(2);
    const [originalRow, mirrorRow] = nestedRows;
    expect(originalRow.edge.id).not.toBe(mirrorRow.edge.id);
    const originalAncestorPath = originalRow.ancestorEdgeIds;
    const mirrorAncestorPath = mirrorRow.ancestorEdgeIds;
    expect(originalAncestorPath).not.toEqual(mirrorAncestorPath);
  });
});

describe("task pane selector", () => {
  it("groups tasks into sections and days with defaults", () => {
    const outline = createOutlineDoc();
    const snap = () => createOutlineSnapshot(outline);

    // Helper to create a task node with optional due date via metadata or pill
    const createTask = (text: string, opts: { metaIso?: string; pillIso?: string } = {}) => {
      const nodeId = createNode(outline, { text });
      addEdge(outline, { parentNodeId: null, childNodeId: nodeId });
      if (opts.metaIso) {
        updateNodeMetadata(outline, nodeId, { todo: { done: false, dueDate: opts.metaIso } });
      }
      if (opts.pillIso) {
        const pill = buildDatePillHtml({ date: new Date(opts.pillIso), displayText: "date", hasTime: false });
        setNodeText(outline, nodeId, `${pill} ${text}`);
      } else {
        // mark as task when only metadata done flag provided
        if (!opts.metaIso) {
          updateNodeMetadata(outline, nodeId, { todo: { done: false } });
        }
      }
      return nodeId;
    };

    const base = new Date(Date.UTC(2024, 2, 10, 0, 0, 0, 0)); // 2024-03-10
    const d = (offset: number) => new Date(Date.UTC(2024, 2, 10 + offset, 0, 0, 0, 0)).toISOString();

    // Overdue (yesterday)
    createTask("overdue", { metaIso: d(-1) });
    // Today
    createTask("today", { metaIso: d(0) });
    // Next seven days
    createTask("tomorrow", { metaIso: d(1) });
    createTask("in six days", { metaIso: d(6) });
    // Later
    createTask("later", { metaIso: d(8) });
    // Undated
    createTask("undated");

    // Build rows
    const { rows } = buildTaskPaneRows(snap(), { showCompleted: true, today: base, includeEmptyNextSevenDaysDays: true, outline });

    // Expect section headers present
    expect(rows.some((r) => r.kind === "sectionHeader" && r.section === "Overdue")).toBe(true);
    expect(rows.some((r) => r.kind === "sectionHeader" && r.section === "Today")).toBe(true);
    expect(rows.some((r) => r.kind === "sectionHeader" && r.section === "NextSevenDays")).toBe(true);
    expect(rows.some((r) => r.kind === "sectionHeader" && r.section === "Later")).toBe(true);
    expect(rows.some((r) => r.kind === "sectionHeader" && r.section === "Undated")).toBe(true);

    // Next seven days should include 7 day headers (even if some empty)
    const nextSevenDayHeaders = rows.filter((r) => r.kind === "dayHeader" && r.section === "NextSevenDays");
    expect(nextSevenDayHeaders.length).toBeGreaterThanOrEqual(7);

    // Today section should include a task row
    const todayTasks = rows.filter((r) => r.kind === "task" && r.section === "Today");
    expect(todayTasks.length).toBe(1);
  });
});
