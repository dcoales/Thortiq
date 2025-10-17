import { describe, it, expect } from "vitest";
import { createOutlineDoc } from "../transactions";
import { addEdge } from "../edges";
import { createNode, setNodeText } from "../nodes";
import { getTaskDueDate, setTaskDueDate } from "../tasks";
import { buildDatePillHtml } from "../journal";


describe("doc/tasks", () => {
  it("prefers metadata dueDate over inline pill", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "Task", metadata: { todo: { done: false, dueDate: "2024-01-10T00:00:00.000Z" } } });
    addEdge(outline, { parentNodeId: null, childNodeId: nodeId });

    const pill = buildDatePillHtml({ date: new Date("2023-12-31T00:00:00.000Z"), displayText: "Sun, Dec 31" });
    setNodeText(outline, nodeId, `${pill} Task`);

    const due = getTaskDueDate(outline, nodeId);
    expect(due?.toISOString()).toBe("2024-01-10T00:00:00.000Z");
  });

  it("updates inline mark when present and syncs metadata", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "" });
    addEdge(outline, { parentNodeId: null, childNodeId: nodeId });

    const pill = buildDatePillHtml({ date: new Date("2024-03-10T00:00:00.000Z"), displayText: "Sun, Mar 10" });
    setNodeText(outline, nodeId, `${pill} task text`);

    const next = new Date("2024-03-12T00:00:00.000Z");
    setTaskDueDate(outline, nodeId, next);

    const due = getTaskDueDate(outline, nodeId);
    expect(due?.toISOString()).toBe("2024-03-12T00:00:00.000Z");
  });
});

