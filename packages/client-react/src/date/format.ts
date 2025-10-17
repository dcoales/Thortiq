import type { OutlineDoc } from "@thortiq/client-core";
import { getUserSetting } from "@thortiq/client-core/preferences";

export const parseIsoDate = (value: string | null): Date | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDateDisplayText = (
  outline: OutlineDoc,
  date: Date,
  hasTime: boolean
): string => {
  const userFormat = getUserSetting(outline, "datePillFormat") as string;
  const format = typeof userFormat === "string" && userFormat.length > 0 ? userFormat : "ddd, MMM D";
  const options: Intl.DateTimeFormatOptions = {
    weekday: format.includes("ddd") ? "short" : undefined,
    month: format.includes("MMM") ? "short" : undefined,
    day: format.includes("D") ? "numeric" : undefined,
    hour: hasTime && format.includes("h") ? "numeric" : undefined,
    minute: hasTime && format.includes("mm") ? "2-digit" : undefined,
    hour12: format.includes("a") ? true : undefined
  };
  return new Intl.DateTimeFormat("en-US", options).format(date);
};


