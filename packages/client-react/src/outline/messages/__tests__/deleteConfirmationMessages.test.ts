import { describe, expect, it } from "vitest";

import { formatDeleteConfirmationMessage } from "../deleteConfirmationMessages";

const createSummary = (options: {
  readonly removedEdgeCount: number;
  readonly promotedOriginalNodeIds?: readonly string[];
}) => ({
  removedEdgeCount: options.removedEdgeCount,
  topLevelEdgeCount: 1,
  promotedOriginalNodeIds: options.promotedOriginalNodeIds ?? []
});

describe("formatDeleteConfirmationMessage", () => {
  it("describes single node deletion without promotions", () => {
    const summary = createSummary({ removedEdgeCount: 1 });

    expect(formatDeleteConfirmationMessage(summary)).toBe(
      "Delete 1 node? This also removes its descendants."
    );
  });

  it("pluralises node count for large deletions", () => {
    const summary = createSummary({ removedEdgeCount: 42 });

    expect(formatDeleteConfirmationMessage(summary)).toBe(
      "Delete 42 nodes? This also removes their descendants."
    );
  });

  it("appends mirror promotion guidance", () => {
    const summary = createSummary({
      removedEdgeCount: 3,
      promotedOriginalNodeIds: ["node-1"]
    });

    expect(formatDeleteConfirmationMessage(summary)).toBe(
      "Delete 3 nodes? This also removes their descendants.\n\n"
      + "This selection includes 1 original node that still has a mirror; that mirror will become the primary copy."
    );
  });

  it("pluralises mirror promotion guidance", () => {
    const summary = createSummary({
      removedEdgeCount: 7,
      promotedOriginalNodeIds: ["node-1", "node-2"]
    });

    expect(formatDeleteConfirmationMessage(summary)).toBe(
      "Delete 7 nodes? This also removes their descendants.\n\n"
      + "This selection includes 2 original nodes that still have mirrors; those mirrors will become the primary copies."
    );
  });
});
