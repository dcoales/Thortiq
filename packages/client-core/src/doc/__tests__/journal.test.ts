import { describe, it, expect } from "vitest";
import { createOutlineDoc } from "../../doc/transactions";
import { addEdge } from "../../doc/edges";
import { createNode } from "../../doc/nodes";
import { findJournalEntryForDate, ensureJournalEntry, ensureFirstChild } from "../journal";

describe("journal helpers", () => {
  it("creates an entry when missing and finds it by date", () => {
    const outline = createOutlineDoc();
    const journalNodeId = createNode(outline, { text: "Journal" });
    addEdge(outline, { parentNodeId: null, childNodeId: journalNodeId });

    const date = new Date(Date.UTC(2024, 0, 15, 0, 0, 0, 0));
    expect(findJournalEntryForDate(outline, journalNodeId, date)).toBeNull();

    const { entryNodeId, didCreate } = ensureJournalEntry(outline, journalNodeId, date, "Mon, Jan 15");
    expect(didCreate).toBe(true);
    expect(entryNodeId).toBeTruthy();

    const found = findJournalEntryForDate(outline, journalNodeId, date);
    expect(found).toBe(entryNodeId);
  });

  it("ensures a first child under entry", () => {
    const outline = createOutlineDoc();
    const journalNodeId = createNode(outline, { text: "Journal" });
    addEdge(outline, { parentNodeId: null, childNodeId: journalNodeId });
    const date = new Date(Date.UTC(2024, 0, 16, 0, 0, 0, 0));

    const { entryNodeId } = ensureJournalEntry(outline, journalNodeId, date, "Tue, Jan 16");
    const first = ensureFirstChild(outline, entryNodeId);
    expect(first).toBeTruthy();
    const again = ensureFirstChild(outline, entryNodeId);
    expect(again).toBe(first);
  });
});


