import { describe, it, expect } from "vitest";
import { createOutlineDoc } from "./transactions";
import { addEdge } from "./edges";
import { createNode, setNodeText, updateNodeMetadata } from "./nodes";
import { getTaskDueDate, setTaskDueDate, setTasksDueDate } from "./tasks";
import { getNodeSnapshot } from "./index";
import { buildDatePillHtml } from "./journal";


describe("tasks helpers", () => {
  it("reads due date from metadata when present", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "Task A", metadata: { todo: { done: false, dueDate: new Date("2024-01-15T00:00:00.000Z").toISOString() } } });
    addEdge(outline, { parentNodeId: null, childNodeId: nodeId });

    const due = getTaskDueDate(outline, nodeId);
    expect(due).not.toBeNull();
    expect(due?.toISOString()).toBe("2024-01-15T00:00:00.000Z");
  });

  it("falls back to first inline date mark when metadata missing", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "" });
    addEdge(outline, { parentNodeId: null, childNodeId: nodeId });

    const pill = buildDatePillHtml({ date: new Date("2024-02-20T00:00:00.000Z"), displayText: "Tue, Feb 20", hasTime: false });
    setNodeText(outline, nodeId, `${pill} follow up`);

    const due = getTaskDueDate(outline, nodeId);
    expect(due?.toISOString()).toBe("2024-02-20T00:00:00.000Z");
  });

  it("setTaskDueDate updates inline mark if present and syncs metadata", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "" });
    addEdge(outline, { parentNodeId: null, childNodeId: nodeId });

    const pill = buildDatePillHtml({ date: new Date("2024-03-10T00:00:00.000Z"), displayText: "Sun, Mar 10", hasTime: false });
    setNodeText(outline, nodeId, `${pill} task text`);

    const nextDate = new Date("2024-03-12T00:00:00.000Z");
    setTaskDueDate(outline, nodeId, nextDate);

    const due = getTaskDueDate(outline, nodeId);
    expect(due?.toISOString()).toBe("2024-03-12T00:00:00.000Z");
  });

  it("setTaskDueDate sets metadata when no inline date exists", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "No pill yet", metadata: { todo: { done: false } } });
    addEdge(outline, { parentNodeId: null, childNodeId: nodeId });

    const nextDate = new Date("2024-04-05T00:00:00.000Z");
    setTaskDueDate(outline, nodeId, nextDate);

    const due = getTaskDueDate(outline, nodeId);
    expect(due?.toISOString()).toBe("2024-04-05T00:00:00.000Z");
  });

  it("preserves done flag when syncing metadata in setTaskDueDate", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "Done task", metadata: { todo: { done: true } } });
    addEdge(outline, { parentNodeId: null, childNodeId: nodeId });

    setTaskDueDate(outline, nodeId, new Date("2024-05-01T00:00:00.000Z"));

    // ensure done remains true
    updateNodeMetadata(outline, nodeId, { });
    const due = getTaskDueDate(outline, nodeId);
    expect(due?.toISOString()).toBe("2024-05-01T00:00:00.000Z");
  });

  it("appends date pill at the end when none exists (single)", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "Follow up with team", metadata: { todo: { done: false } } });
    addEdge(outline, { parentNodeId: null, childNodeId: nodeId });

    const target = new Date("2024-06-15T00:00:00.000Z");
    setTaskDueDate(outline, nodeId, target);

    const snap = getNodeSnapshot(outline, nodeId);
    expect(snap.inlineContent.length).toBeGreaterThan(0);
    const last = snap.inlineContent[snap.inlineContent.length - 1];
    const hasDate = last.marks.some((m) => m.type === "date");
    expect(hasDate).toBe(true);
  });

  it("appends date pill at the end when none exists (multi)", () => {
    const outline = createOutlineDoc();
    const a = createNode(outline, { text: "Task A", metadata: { todo: { done: false } } });
    const b = createNode(outline, { text: "Task B", metadata: { todo: { done: false } } });
    addEdge(outline, { parentNodeId: null, childNodeId: a });
    addEdge(outline, { parentNodeId: null, childNodeId: b });

    const target = new Date("2024-06-16T00:00:00.000Z");
    setTasksDueDate(outline, [a, b], target);

    const snapA = getNodeSnapshot(outline, a);
    const snapB = getNodeSnapshot(outline, b);
    const lastA = snapA.inlineContent[snapA.inlineContent.length - 1];
    const lastB = snapB.inlineContent[snapB.inlineContent.length - 1];
    expect(lastA.marks.some((m) => m.type === "date")).toBe(true);
    expect(lastB.marks.some((m) => m.type === "date")).toBe(true);
  });
});

