import type { DeletePlanSummary } from "@thortiq/outline-commands";

const formatCount = (count: number, singular: string, plural: string): string => {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
};

export const formatDeleteConfirmationMessage = (summary: DeletePlanSummary): string => {
  const nodeCountText = formatCount(summary.removedEdgeCount, "node", "nodes");
  const descendantPronoun = summary.removedEdgeCount === 1 ? "its" : "their";
  const base = `Delete ${nodeCountText}? This also removes ${descendantPronoun} descendants.`;

  const mirrorPromotionCount = summary.promotedOriginalNodeIds.length;
  if (mirrorPromotionCount === 0) {
    return base;
  }

  const mirrorSentence = mirrorPromotionCount === 1
    ? "This selection includes 1 original node that still has a mirror; that mirror will become the primary copy."
    : `This selection includes ${mirrorPromotionCount} original nodes that still have mirrors; those mirrors will become the primary copies.`;

  return `${base}\n\n${mirrorSentence}`;
};
