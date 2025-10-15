import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

interface AnchorPosition {
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
}

export interface DatePickerPopoverProps {
  readonly anchor: AnchorPosition;
  readonly value: Date | null;
  readonly onSelect: (date: Date) => void;
  readonly onClose: () => void;
}

const POPOVER_WIDTH = 260;

const popoverStyleBase: CSSProperties = {
  position: "fixed",
  width: `${POPOVER_WIDTH}px`,
  padding: "0.75rem",
  borderRadius: "0.75rem",
  border: "1px solid rgba(148, 163, 184, 0.28)",
  backgroundColor: "#ffffff",
  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.22)",
  zIndex: 2200,
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem"
};

const calendarContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem"
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  fontSize: "0.8rem",
  color: "#475569",
  fontWeight: 500
};

const monthSwitcherStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem"
};

const monthLabelStyle: CSSProperties = {
  minWidth: "7rem",
  textAlign: "center",
  fontSize: "0.85rem",
  fontWeight: 600,
  color: "#1f2937"
};

const navButtonStyle: CSSProperties = {
  width: "1.75rem",
  height: "1.75rem",
  borderRadius: "9999px",
  border: "1px solid rgba(148, 163, 184, 0.5)",
  backgroundColor: "#f8fafc",
  color: "#1f2937",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center"
};

const weekdayRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
  gap: "0.35rem",
  fontSize: "0.7rem",
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.04em"
};

const weekdayLabelStyle: CSSProperties = {
  textAlign: "center"
};

const dayGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
  gap: "0.25rem"
};

const dayButtonStyle: CSSProperties = {
  borderRadius: "0.5rem",
  border: "1px solid transparent",
  backgroundColor: "transparent",
  color: "#0f172a",
  cursor: "pointer",
  padding: "0.4rem 0",
  fontSize: "0.85rem",
  lineHeight: 1,
  transition: "background-color 120ms ease, color 120ms ease, border-color 120ms ease"
};

const outsideMonthDayStyle: CSSProperties = {
  color: "#94a3b8"
};

const todayDayStyle: CSSProperties = {
  borderColor: "rgba(79, 70, 229, 0.5)",
  fontWeight: 600
};

const selectedDayStyle: CSSProperties = {
  backgroundColor: "#4f46e5",
  color: "#ffffff",
  borderColor: "#4f46e5",
  fontWeight: 600
};

const quickActionsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "0.5rem"
};

const quickActionButtonStyle: CSSProperties = {
  padding: "0.4rem 0.5rem",
  borderRadius: "0.5rem",
  border: "1px solid rgba(148, 163, 184, 0.5)",
  backgroundColor: "#f8fafc",
  color: "#1f2937",
  cursor: "pointer",
  fontSize: "0.85rem",
  transition: "background-color 120ms ease, border-color 120ms ease"
};

const startOfToday = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
};

const applyRelativeDayOffset = (seed: Date, days: number): Date => {
  const next = new Date(seed);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const normalizeDateUtc = (value: Date): Date => {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));
};

const startOfMonthUtc = (value: Date): Date => {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1, 0, 0, 0, 0));
};

const shiftMonthUtc = (value: Date, offset: number): Date => {
  const next = new Date(value);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + offset);
  return startOfMonthUtc(next);
};

const buildCalendarWeeks = (monthStart: Date): ReadonlyArray<ReadonlyArray<Date>> => {
  const weeks: Date[][] = [];
  const firstWeekStart = applyRelativeDayOffset(monthStart, -monthStart.getUTCDay());
  let cursor = firstWeekStart;

  for (let weekIndex = 0; weekIndex < 6; weekIndex += 1) {
    const days: Date[] = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      days.push(cursor);
      cursor = applyRelativeDayOffset(cursor, 1);
    }
    weeks.push(days);
  }

  return weeks;
};

const isSameDayUtc = (left: Date | null, right: Date | null): boolean => {
  if (!left || !right) {
    return false;
  }
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
};

const computePosition = ({ left, bottom }: AnchorPosition): { left: number; top: number } => {
  if (typeof window === "undefined") {
    return { left, top: bottom + 4 };
  }
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const computedLeft = Math.max(8, Math.min(left, viewportWidth - POPOVER_WIDTH - 8));
  const desiredTop = bottom + 4;
  const maxTop = viewportHeight - 8 - 240;
  const computedTop = Math.max(8, Math.min(desiredTop, maxTop));
  return { left: computedLeft, top: computedTop };
};

export const DatePickerPopover = ({
  anchor,
  value,
  onSelect,
  onClose
}: DatePickerPopoverProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const today = useMemo(startOfToday, []);
  const [displayMonth, setDisplayMonth] = useState(() => {
    const base = value && !Number.isNaN(value.getTime()) ? value : today;
    return startOfMonthUtc(base);
  });
  const selectedDate = useMemo(() => {
    if (!value || Number.isNaN(value.getTime())) {
      return null;
    }
    return normalizeDateUtc(value);
  }, [value]);
  const locale = useMemo(() => {
    if (typeof navigator !== "undefined" && navigator.language) {
      return navigator.language;
    }
    return "en-US";
  }, []);
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
    [locale]
  );
  const weekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "short" }),
    [locale]
  );
  const dayLabelFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "full" }),
    [locale]
  );
  const weekdayLabels = useMemo(() => {
    const sunday = new Date(Date.UTC(2023, 0, 1));
    return Array.from({ length: 7 }, (_, index) =>
      weekdayFormatter.format(applyRelativeDayOffset(sunday, index))
    );
  }, [weekdayFormatter]);
  const weeks = useMemo(() => buildCalendarWeeks(displayMonth), [displayMonth]);

  useEffect(() => {
    setDisplayMonth((current) => {
      const candidate = value && !Number.isNaN(value.getTime()) ? value : today;
      const targetMonth = startOfMonthUtc(candidate);
      if (
        current.getUTCFullYear() === targetMonth.getUTCFullYear() &&
        current.getUTCMonth() === targetMonth.getUTCMonth()
      ) {
        return current;
      }
      return targetMonth;
    });
  }, [today, value]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current) {
        return;
      }
      if (containerRef.current.contains(event.target as Node)) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const position = useMemo(() => computePosition(anchor), [anchor]);

  const applySelection = (next: Date | null) => {
    if (!next) {
      return;
    }
    onSelect(normalizeDateUtc(next));
    onClose();
  };

  return (
    <div
      ref={containerRef}
      style={{ ...popoverStyleBase, left: position.left, top: position.top }}
      data-outline-date-picker="true"
    >
      <div style={calendarContainerStyle}>
        <div style={sectionHeaderStyle}>
          <span>Date</span>
          <div style={monthSwitcherStyle}>
            <button
              type="button"
              style={navButtonStyle}
              aria-label="Previous month"
              onClick={() => {
                setDisplayMonth((current) => shiftMonthUtc(current, -1));
              }}
            >
              <span aria-hidden="true">‹</span>
            </button>
            <span style={monthLabelStyle}>{monthFormatter.format(displayMonth)}</span>
            <button
              type="button"
              style={navButtonStyle}
              aria-label="Next month"
              onClick={() => {
                setDisplayMonth((current) => shiftMonthUtc(current, 1));
              }}
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
        </div>
        <div style={weekdayRowStyle}>
          {weekdayLabels.map((label, index) => (
            <span key={`weekday-${index}`} style={weekdayLabelStyle}>
              {label}
            </span>
          ))}
        </div>
        <div style={dayGridStyle}>
          {weeks.map((week) =>
            week.map((day) => {
              const isCurrentMonth = day.getUTCMonth() === displayMonth.getUTCMonth();
              const isSelected = isSameDayUtc(day, selectedDate);
              const isToday = isSameDayUtc(day, today);
              const style: CSSProperties = {
                ...dayButtonStyle,
                ...(isCurrentMonth ? {} : outsideMonthDayStyle),
                ...(isToday ? todayDayStyle : {}),
                ...(isSelected ? selectedDayStyle : {})
              };
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  style={style}
                  onClick={() => applySelection(day)}
                  aria-pressed={isSelected}
                  aria-current={isToday ? "date" : undefined}
                  aria-label={dayLabelFormatter.format(day)}
                  data-outline-date-picker-day="true"
                >
                  {day.getUTCDate()}
                </button>
              );
            })
          )}
        </div>
      </div>
      <div style={quickActionsStyle}>
        <button
          type="button"
          style={quickActionButtonStyle}
          onClick={() => applySelection(today)}
        >
          Today
        </button>
        <button
          type="button"
          style={quickActionButtonStyle}
          onClick={() => applySelection(applyRelativeDayOffset(today, 1))}
        >
          Tomorrow
        </button>
        <button
          type="button"
          style={quickActionButtonStyle}
          onClick={() => applySelection(applyRelativeDayOffset(today, 7))}
        >
          Next Week
        </button>
        <button
          type="button"
          style={quickActionButtonStyle}
          onClick={() => {
            const nextMonth = new Date(today);
            nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
            applySelection(nextMonth);
          }}
        >
          Next Month
        </button>
      </div>
    </div>
  );
};
