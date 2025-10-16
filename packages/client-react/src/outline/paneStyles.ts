import type { CSSProperties } from "react";

/**
 * Shared pane styling tokens so web and desktop shells keep visual parity without duplicating
 * magic values. The active indicator forms a solid underline beneath the pane header.
 */
export const PANE_HEADER_BASE_STYLE: CSSProperties = {
  borderBottomWidth: 2,
  borderBottomStyle: "solid",
  borderBottomColor: "#d1d5db"
};

export const PANE_HEADER_ACTIVE_STYLE: CSSProperties = {
  borderBottomColor: "#f97316"
};
