import type { NodeHeadingLevel } from "../types";

export interface OutlineHeadingTypography {
  readonly fontSizeRem: number;
  readonly lineHeight: number;
  readonly fontWeight: number;
}

export interface OutlineTagTypography {
  readonly fontSizeRem: number;
  readonly fontWeight: number;
  readonly lineHeight: number;
  readonly horizontalPaddingRem: number;
  readonly verticalPaddingRem: number;
}

export const OUTLINE_BODY_FONT_SIZE_REM = 1;
export const OUTLINE_BODY_LINE_HEIGHT_REM = 1.4;
export const OUTLINE_BODY_FONT_WEIGHT = 400;

export const OUTLINE_STRONG_FONT_WEIGHT = 700;
export const OUTLINE_EM_FONT_STYLE = "italic";

export const OUTLINE_HEADING_TYPOGRAPHY: Readonly<Record<NodeHeadingLevel, OutlineHeadingTypography>> = {
  1: { fontSizeRem: 1.6, lineHeight: 1.25, fontWeight: 700 },
  2: { fontSizeRem: 1.45, lineHeight: 1.25, fontWeight: 700 },
  3: { fontSizeRem: 1.3, lineHeight: 1.25, fontWeight: 700 },
  4: { fontSizeRem: 1.15, lineHeight: 1.25, fontWeight: 700 },
  5: { fontSizeRem: 1, lineHeight: 1.25, fontWeight: 700 }
};

export const OUTLINE_TAG_TYPOGRAPHY: OutlineTagTypography = {
  fontSizeRem: 0.85,
  fontWeight: 600,
  lineHeight: 1.2,
  horizontalPaddingRem: 0.45,
  verticalPaddingRem: 0.05
};

export const headingTypographyToCss = (typography: OutlineHeadingTypography): string => {
  return [
    `font-size: ${typography.fontSizeRem}rem`,
    `font-weight: ${typography.fontWeight}`,
    `line-height: ${typography.lineHeight}`
  ].join(";");
};
