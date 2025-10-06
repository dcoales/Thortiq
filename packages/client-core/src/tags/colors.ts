/**
 * Tag color utilities for consistent tag rendering across the application.
 * Tags are assigned colors deterministically based on their name.
 */

export interface TagColor {
  readonly background: string;
  readonly text: string;
}

// 8 predefined colors with good contrast and visual distinction
const TAG_COLORS: readonly TagColor[] = [
  { background: "#ef4444", text: "#ffffff" }, // Red
  { background: "#f97316", text: "#ffffff" }, // Orange
  { background: "#eab308", text: "#000000" }, // Yellow
  { background: "#22c55e", text: "#000000" }, // Green
  { background: "#06b6d4", text: "#000000" }, // Cyan
  { background: "#3b82f6", text: "#ffffff" }, // Blue
  { background: "#8b5cf6", text: "#ffffff" }, // Purple
  { background: "#ec4899", text: "#ffffff" }  // Pink
];

/**
 * Simple string hash function for consistent color assignment.
 */
const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
};

/**
 * Get a consistent color for a tag based on its name.
 */
export const getTagColor = (tagName: string): TagColor => {
  const normalized = tagName.toLowerCase().trim();
  const hash = hashString(normalized);
  const index = hash % TAG_COLORS.length;
  return TAG_COLORS[index];
};

/**
 * Get the background color for a tag.
 */
export const getTagBackgroundColor = (tagName: string): string => {
  return getTagColor(tagName).background;
};

/**
 * Get the appropriate text color for a tag background.
 */
export const getTagTextColor = (tagName: string): string => {
  return getTagColor(tagName).text;
};

/**
 * Calculate luminance of a hex color to determine if it's light or dark.
 * Used for contrast calculation when background color is custom.
 */
const calculateLuminance = (hexColor: string): number => {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

/**
 * Get contrasting text color (black or white) for any background color.
 */
export const getContrastTextColor = (backgroundColor: string): string => {
  const luminance = calculateLuminance(backgroundColor);
  return luminance > 0.5 ? "#000000" : "#ffffff";
};



