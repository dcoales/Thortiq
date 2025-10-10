import { describe, expect, it } from "vitest";

import {
  clearInboxNode,
  clearJournalNode,
  getInboxNodeId,
  getInboxSnapshot,
  getJournalNodeId,
  getJournalSnapshot,
  setInboxNodeId,
  setJournalNodeId
} from "../singletonNodes";
import { addEdge, createNode, createOutlineDoc } from "../../doc";
import type { NodeId } from "../../ids";

describe("singletonNodes", () => {
  it("stores and retrieves inbox and journal node ids", () => {
    const outline = createOutlineDoc();
    const origin = Symbol("test");
    const inboxNode = createNode(outline, { text: "Inbox", origin });
    const journalNode = createNode(outline, { text: "Journal", origin });
    addEdge(outline, { parentNodeId: null, childNodeId: inboxNode, origin });
    addEdge(outline, { parentNodeId: null, childNodeId: journalNode, origin });

    setInboxNodeId(outline, inboxNode, origin);
    setJournalNodeId(outline, journalNode, origin);

    expect(getInboxNodeId(outline)).toBe(inboxNode);
    expect(getJournalNodeId(outline)).toBe(journalNode);

    const inboxSnapshot = getInboxSnapshot(outline);
    const journalSnapshot = getJournalSnapshot(outline);
    expect(inboxSnapshot).not.toBeNull();
    expect(journalSnapshot).not.toBeNull();
    expect(inboxSnapshot?.nodeId).toBe(inboxNode);
    expect(journalSnapshot?.nodeId).toBe(journalNode);
    expect(typeof inboxSnapshot?.assignedAt).toBe("number");
    expect(typeof journalSnapshot?.assignedAt).toBe("number");
  });

  it("overwrites existing assignments and can clear them", () => {
    const outline = createOutlineDoc();
    const origin = Symbol("test");
    const firstNode = createNode(outline, { text: "First", origin });
    const secondNode = createNode(outline, { text: "Second", origin });
    addEdge(outline, { parentNodeId: null, childNodeId: firstNode, origin });
    addEdge(outline, { parentNodeId: null, childNodeId: secondNode, origin });

    setInboxNodeId(outline, firstNode, origin);
    setInboxNodeId(outline, secondNode, origin);
    expect(getInboxNodeId(outline)).toBe(secondNode);

    clearInboxNode(outline, origin);
    expect(getInboxNodeId(outline)).toBeNull();
    clearJournalNode(outline, origin);
    expect(getJournalNodeId(outline)).toBeNull();
  });

  it("throws when assigning a missing node id", () => {
    const outline = createOutlineDoc();
    const missingNodeId = "missing-node" as NodeId;
    expect(() => setInboxNodeId(outline, missingNodeId)).toThrow(/missing node/i);
    expect(() => setJournalNodeId(outline, missingNodeId)).toThrow(/missing node/i);
  });
});
