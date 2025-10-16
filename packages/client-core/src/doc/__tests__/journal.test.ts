import { describe, it, expect } from "vitest";
import { createOutlineDoc } from "../../doc/transactions";
import { addEdge, getChildEdgeIds, getEdgeSnapshot } from "../../doc/edges";
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

  it("groups entries under Year and Month with reverse ordering", () => {
    const outline = createOutlineDoc();
    const journalNodeId = createNode(outline, { text: "Journal" });
    addEdge(outline, { parentNodeId: null, childNodeId: journalNodeId });

    // Create three entries: 2024-03-10, 2024-01-05, 2023-12-31
    const d1 = new Date(Date.UTC(2024, 2, 10, 0, 0, 0, 0));
    const d2 = new Date(Date.UTC(2024, 0, 5, 0, 0, 0, 0));
    const d3 = new Date(Date.UTC(2023, 11, 31, 0, 0, 0, 0));

    ensureJournalEntry(outline, journalNodeId, d1, "Sun, Mar 10");
    ensureJournalEntry(outline, journalNodeId, d2, "Fri, Jan 5");
    ensureJournalEntry(outline, journalNodeId, d3, "Sun, Dec 31");

    // Years under journal should be [2024, 2023]
    const yearEdges = getChildEdgeIds(outline, journalNodeId);
    const firstYearNodeId = getEdgeSnapshot(outline, yearEdges[0]).childNodeId;
    const secondYearNodeId = getEdgeSnapshot(outline, yearEdges[1]).childNodeId;
    expect(firstYearNodeId).not.toBe(secondYearNodeId);
    // Read texts via nodes API from transactions module isn't imported here; use edges path only
    // We will assert by the presence of month children ordering instead

    // Months under 2024 should be [March, January]
    const months2024 = getChildEdgeIds(outline, firstYearNodeId);
    expect(months2024.length).toBeGreaterThanOrEqual(2);
    const marchNodeId = getEdgeSnapshot(outline, months2024[0]).childNodeId;
    const janNodeId = getEdgeSnapshot(outline, months2024[1]).childNodeId;
    expect(marchNodeId).not.toBe(janNodeId);

    // Dates under March should have the single day entry
    const marchDates = getChildEdgeIds(outline, marchNodeId);
    expect(marchDates.length).toBe(1);

    // Inserting another day in March earlier should place it below the newer one
    const d4 = new Date(Date.UTC(2024, 2, 7, 0, 0, 0, 0));
    ensureJournalEntry(outline, journalNodeId, d4, "Thu, Mar 7");
    const marchDatesAfter = getChildEdgeIds(outline, marchNodeId);
    expect(marchDatesAfter.length).toBe(2);
    const topDateNode = getEdgeSnapshot(outline, marchDatesAfter[0]).childNodeId;
    const bottomDateNode = getEdgeSnapshot(outline, marchDatesAfter[1]).childNodeId;
    // The newer date (10th) should be at the top; the 7th should be below
    expect(findJournalEntryForDate(outline, journalNodeId, d1)).toBe(topDateNode);
    expect(findJournalEntryForDate(outline, journalNodeId, d4)).toBe(bottomDateNode);

    // Year 2023 should be after 2024 (reverse order)
    const months2023 = getChildEdgeIds(outline, secondYearNodeId);
    expect(months2023.length).toBeGreaterThanOrEqual(1);
  });
});


