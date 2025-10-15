/**
 * Date detection plugin that monitors user input for natural language dates
 * and provides a popup for confirmation before converting to date tags.
 */
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import * as chrono from "chrono-node";
import type { EditorState } from "prosemirror-state";

export interface DateDetectionOptions {
  readonly onDateDetected?: (date: Date, text: string, position: { from: number; to: number }) => void;
  readonly onDateConfirmed?: (date: Date, text: string, position: { from: number; to: number }) => void;
  readonly getUserDateFormat?: () => string;
  readonly onDetectionCleared?: () => void;
}

export interface DateDetectionOptionsRef {
  current: DateDetectionOptions | null;
}

export interface DateDetectionPluginState {
  readonly detectedDate: Date | null;
  readonly detectedText: string;
  readonly position: { from: number; to: number } | null;
  readonly isActive: boolean;
}

const DATE_PLUGIN_KEY = new PluginKey<DateDetectionPluginState>("thortiq-date-detection");
const INACTIVE_STATE: DateDetectionPluginState = {
  detectedDate: null,
  detectedText: "",
  position: null,
  isActive: false
};

// (formatting handled by the host; plugin avoids format dependencies)

interface DetectedDate {
  readonly date: Date;
  readonly text: string;
  readonly hasTime: boolean;
  readonly startIndex: number;
  readonly endIndex: number;
}

const WEEKDAY_ALIASES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  "sun.": 0,
  monday: 1,
  mon: 1,
  "mon.": 1,
  tuesday: 2,
  tue: 2,
  "tue.": 2,
  wednesday: 3,
  wed: 3,
  "wed.": 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  "thu.": 4,
  friday: 5,
  fri: 5,
  "fri.": 5,
  saturday: 6,
  sat: 6,
  "sat.": 6
};

const MONTH_ALIASES: Record<string, number> = {
  january: 1,
  jan: 1,
  "jan.": 1,
  february: 2,
  feb: 2,
  "feb.": 2,
  march: 3,
  mar: 3,
  "mar.": 3,
  april: 4,
  apr: 4,
  "apr.": 4,
  may: 5,
  june: 6,
  jun: 6,
  "jun.": 6,
  july: 7,
  jul: 7,
  "jul.": 7,
  august: 8,
  aug: 8,
  "aug.": 8,
  september: 9,
  sept: 9,
  "sept.": 9,
  sep: 9,
  "sep.": 9,
  october: 10,
  oct: 10,
  "oct.": 10,
  november: 11,
  nov: 11,
  "nov.": 11,
  december: 12,
  dec: 12,
  "dec.": 12
};

const CONNECTOR_TOKENS = new Set(["on", "at", "the", "of", "in", "for", "to", "by", "and", ","]);
const ORDINAL_SUFFIX = /(st|nd|rd|th)$/i;

interface StructuredComponents {
  readonly weekday: number | null;
  readonly day: number | null;
  readonly month: number | null;
  readonly year: number | null;
  readonly time: { readonly hour: number; readonly minute: number } | null;
}

const parseDayToken = (token: string): number | null => {
  const cleaned = token.replace(ORDINAL_SUFFIX, "");
  if (!/^\d{1,2}$/.test(cleaned)) {
    return null;
  }
  const value = Number(cleaned);
  if (value < 1 || value > 31) {
    return null;
  }
  return value;
};

const parseYearToken = (token: string): number | null => {
  if (!/^\d{4}$/.test(token)) {
    return null;
  }
  const value = Number(token);
  if (value < 1000 || value > 9999) {
    return null;
  }
  return value;
};

const parseTimeToken = (token: string): { hour: number; minute: number } | null => {
  const match = token.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i);
  if (!match) {
    return null;
  }
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (minute < 0 || minute >= 60) {
    return null;
  }
  const meridiem = match[3]?.toLowerCase();
  const hasMinutes = match[2] != null;
  if (!meridiem && !hasMinutes) {
    return null;
  }
  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return null;
    }
    if (hour === 12) {
      hour = 0;
    }
    if (meridiem === "pm") {
      hour += 12;
    }
  } else {
    if (hour < 0 || hour > 23) {
      return null;
    }
  }
  return { hour, minute };
};

const computeStructuredDate = (components: StructuredComponents): { date: Date; hasTime: boolean } | null => {
  const { weekday, day, month, year, time } = components;
  if (weekday == null) {
    return null;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let base = new Date(today);
  if (year != null) {
    base = new Date(year, month != null ? month - 1 : 0, day != null ? day : 1);
  } else if (month != null && day != null) {
    base = new Date(today.getFullYear(), month - 1, day);
    if (base < today) {
      base.setFullYear(base.getFullYear() + 1);
    }
  } else if (day != null) {
    base = new Date(today.getFullYear(), today.getMonth(), day);
    if (base < today) {
      base.setMonth(base.getMonth() + 1);
    }
  }

  const maxIterations = year != null ? 366 : 366 * 5;
  for (let offset = 0; offset < maxIterations; offset += 1) {
    const current = new Date(base);
    current.setDate(base.getDate() + offset);

    if (year != null) {
      if (current.getFullYear() > year) {
        break;
      }
      if (current.getFullYear() !== year) {
        continue;
      }
    }
    if (month != null && current.getMonth() + 1 !== month) {
      continue;
    }
    if (day != null && current.getDate() !== day) {
      continue;
    }
    if (current.getDay() !== weekday) {
      continue;
    }

    if (time) {
      current.setHours(time.hour, time.minute, 0, 0);
    } else {
      current.setHours(12, 0, 0, 0);
    }

    return { date: current, hasTime: Boolean(time) };
  }

  return null;
};

const parseStructuredCandidate = (text: string): { date: Date; hasTime: boolean } | null => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed !== text) {
    // Trailing whitespace disqualifies the candidate.
    return null;
  }

  const tokens = trimmed.split(/\s+/);
  let weekday: number | null = null;
  let month: number | null = null;
  let day: number | null = null;
  let year: number | null = null;
  let time: { hour: number; minute: number } | null = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const normalized = token.toLowerCase();

    if (CONNECTOR_TOKENS.has(normalized)) {
      continue;
    }

    if (weekday == null && WEEKDAY_ALIASES[normalized] != null) {
      weekday = WEEKDAY_ALIASES[normalized];
      continue;
    }

    if (month == null && MONTH_ALIASES[normalized] != null) {
      month = MONTH_ALIASES[normalized];
      continue;
    }

    const directTime: { hour: number; minute: number } | null =
      time == null ? parseTimeToken(normalized) : null;
    if (directTime) {
      time = directTime;
      continue;
    }

    if (
      time == null &&
      /^\d{1,2}$/.test(normalized) &&
      index + 1 < tokens.length &&
      (tokens[index + 1].toLowerCase() === "am" || tokens[index + 1].toLowerCase() === "pm")
    ) {
      const hourValue = Number(normalized);
      if (hourValue >= 1 && hourValue <= 12) {
        const meridiem = tokens[index + 1].toLowerCase();
        let computedHour = hourValue % 12;
        if (meridiem === "pm") {
          computedHour += 12;
        }
        time = { hour: computedHour, minute: 0 };
        index += 1;
        continue;
      }
    }

    if (day == null) {
      const dayValue = parseDayToken(normalized);
      if (dayValue != null) {
        day = dayValue;
        continue;
      }
    }

    if (year == null) {
      const yearValue = parseYearToken(normalized);
      if (yearValue != null) {
        year = yearValue;
        continue;
      }
    }

    return null;
  }

  if (weekday == null) {
    return null;
  }

  return computeStructuredDate({
    weekday,
    day,
    month,
    year,
    time
  });
};

const detectStructuredDateEndingAtTextEnd = (text: string): DetectedDate | null => {
  if (text.length === 0) {
    return null;
  }
  if (text.trimEnd().length !== text.length) {
    return null;
  }

  for (let start = text.length; start >= 0; start -= 1) {
    if (start > 0) {
      const previousChar = text[start - 1];
      if (previousChar && /\S/.test(previousChar)) {
        continue;
      }
    }
    const slice = text.slice(start);
    if (!/\S/.test(slice)) {
      continue;
    }
    const trimmedLeading = slice.replace(/^\s+/, "");
    const structured = parseStructuredCandidate(trimmedLeading);
    if (structured) {
      const leadingWhitespace = slice.length - trimmedLeading.length;
      const actualStart = start + leadingWhitespace;
      return {
        date: structured.date,
        hasTime: structured.hasTime,
        text: text.slice(actualStart),
        startIndex: actualStart,
        endIndex: text.length
      };
    }
  }

  return null;
};

/**
 * Detects the first natural language date within the supplied text.
 */
const detectDateInText = (text: string): DetectedDate | null => {
  const results = chrono.parse(text);
  if (results.length === 0) {
    return null;
  }

  const result = results[0];
  const date = result.start.date();
  const hasTime = result.start.isCertain("hour") || result.start.isCertain("minute");
  const startIndex = typeof result.index === "number" ? result.index : text.indexOf(result.text);
  if (startIndex < 0) {
    return null;
  }

  return {
    date,
    text: result.text,
    hasTime,
    startIndex,
    endIndex: startIndex + result.text.length
  };
};

/**
 * Detects a natural language date that ends exactly at the end of the provided text.
 * Returns the last match that satisfies the constraint so we always favour the suffix
 * closest to the caret.
 */
const detectDateEndingAtTextEnd = (text: string): DetectedDate | null => {
  const results = chrono.parse(text);
  if (results.length === 0) {
    return detectStructuredDateEndingAtTextEnd(text);
  }

  let candidate: DetectedDate | null = null;
  for (const result of results) {
    const startIndex = typeof result.index === "number" ? result.index : text.indexOf(result.text);
    if (startIndex < 0) {
      continue;
    }
    const endIndex = startIndex + result.text.length;
    if (endIndex !== text.length) {
      continue;
    }
    const date = result.start.date();
    const hasTime = result.start.isCertain("hour") || result.start.isCertain("minute");
    candidate = {
      date,
      text: result.text,
      hasTime,
      startIndex,
      endIndex
    };
  }
  if (candidate) {
    if (candidate.startIndex === 0) {
      return candidate;
    }
    const structuredFallback = detectStructuredDateEndingAtTextEnd(text);
    if (structuredFallback && structuredFallback.startIndex <= candidate.startIndex) {
      return structuredFallback;
    }
    return candidate;
  }
  return detectStructuredDateEndingAtTextEnd(text);
};

/**
 * Creates the date detection plugin
 */
export const createDateDetectionPlugin = (optionsRef: DateDetectionOptionsRef): Plugin<DateDetectionPluginState> => {
  const notifyDetectionCleared = (): void => {
    const options = optionsRef.current;
    options?.onDetectionCleared?.();
  };
  const deactivate = (): DateDetectionPluginState => {
    notifyDetectionCleared();
    return INACTIVE_STATE;
  };

  return new Plugin({
    key: DATE_PLUGIN_KEY,
    state: {
      init: (): DateDetectionPluginState => INACTIVE_STATE,
      
      apply: (
        tr: Transaction,
        value: DateDetectionPluginState,
        _oldState: EditorState,
        newState: EditorState
      ): DateDetectionPluginState => {
        // Check for date detection metadata first
        const dateDetectionMeta = tr.getMeta(DATE_PLUGIN_KEY);
        if (dateDetectionMeta) {
          console.log("Date plugin: Applying metadata:", dateDetectionMeta);
          if (dateDetectionMeta.isActive === false) {
            notifyDetectionCleared();
          }
          return {
            detectedDate: dateDetectionMeta.detectedDate,
            detectedText: dateDetectionMeta.detectedText,
            position: dateDetectionMeta.position,
            isActive: dateDetectionMeta.isActive !== false
          };
        }
        
        // If we have an active date detection, check if it's still valid
        if (value.isActive && value.position) {
          const { selection } = newState;
          if (!selection.empty) {
            console.log("Date plugin: Deactivating - selection is not collapsed");
            return deactivate();
          }

          const mappedFrom = tr.mapping.map(value.position.from);
          const docSize = tr.doc.content.size;
          if (mappedFrom < 0 || mappedFrom > docSize) {
            console.log("Date plugin: Deactivating - mapped start out of bounds", mappedFrom);
            return deactivate();
          }

          const head = selection.head;
          if (head < mappedFrom) {
            console.log("Date plugin: Deactivating - caret moved before detected range", {
              head,
              mappedFrom
            });
            return deactivate();
          }

          if (head === mappedFrom) {
            console.log("Date plugin: Deactivating - range collapsed");
            return deactivate();
          }

          const candidateRaw = tr.doc.textBetween(mappedFrom, head, "\n", "\n");
          if (candidateRaw.length === 0) {
            console.log("Date plugin: Deactivating - empty candidate");
            return deactivate();
          }

          const leadingWhitespace = candidateRaw.length - candidateRaw.replace(/^\s+/, "").length;
          let candidateStart = mappedFrom + leadingWhitespace;
          let candidateText = leadingWhitespace > 0 ? candidateRaw.slice(leadingWhitespace) : candidateRaw;

          if (candidateText.length === 0) {
            console.log("Date plugin: Deactivating - candidate only whitespace");
            return deactivate();
          }

          if (candidateText.trimEnd().length !== candidateText.length) {
            console.log("Date plugin: Deactivating - candidate has trailing whitespace");
            return deactivate();
          }

          const schema = newState.schema;
          const dateMarkType = schema.marks.date;
          if (dateMarkType) {
            const markRangeEnd = Math.min(head, docSize);
            if (markRangeEnd > candidateStart) {
              const markTypeForCheck = dateMarkType as unknown as Parameters<typeof tr.doc.rangeHasMark>[2];
              if (tr.doc.rangeHasMark(candidateStart, markRangeEnd, markTypeForCheck)) {
                console.log("Date plugin: Deactivating - detected range now contains date mark");
                return deactivate();
              }
            }
          }

          const updatedDetection = detectDateEndingAtTextEnd(candidateText);
          if (!updatedDetection || updatedDetection.startIndex !== 0) {
            console.log("Date plugin: Deactivating - suffix no longer parses as date", {
              candidateText
            });
            return deactivate();
          }

          const detectionStart = candidateStart + updatedDetection.startIndex;
          const detectionEnd = candidateStart + updatedDetection.endIndex;
          const detectedSlice = candidateText.slice(updatedDetection.startIndex, updatedDetection.endIndex);

          if (detectedSlice.length === 0) {
            console.log("Date plugin: Deactivating - detected slice empty");
            return deactivate();
          }

          const updatedState: DateDetectionPluginState = {
            detectedDate: updatedDetection.date,
            detectedText: detectedSlice,
            position: { from: detectionStart, to: detectionEnd },
            isActive: true
          };
          return updatedState;
        }

        // If we reach here and the transaction inserted/removed text but detection is inactive,
        // keep state cleared.
        if (!value.isActive) {
          return INACTIVE_STATE;
        }
        
        return deactivate();
      }
    },
    
    props: {
      handleKeyDown: (view: EditorView, event: KeyboardEvent): boolean => {
        // Backspace directly after a date pill should revert to plain text and reopen detection
        if (event.key === "Backspace") {
          const { state } = view;
          const { selection } = state;
          if (!selection.empty) {
            return false;
          }
          const dateMarkType = state.schema.marks.date;
          if (!dateMarkType) {
            return false;
          }
          const $from = selection.$from;
          const nodeBefore = $from.nodeBefore;
          if (!nodeBefore) {
            return false;
          }
          const mark = nodeBefore.marks.find((candidate) => candidate.type === dateMarkType);
          if (!mark) {
            return false;
          }
          const attrs = mark.attrs as { displayText?: unknown };
          const displayText = typeof attrs.displayText === "string" ? attrs.displayText : nodeBefore.text ?? "";
          const start = $from.pos - nodeBefore.nodeSize;
          event.preventDefault();
          const replacement = state.schema.text(displayText) as unknown as Parameters<Transaction["replaceWith"]>[2];
          let tr = state.tr.replaceWith(start, $from.pos, replacement);
          const selectionDoc = tr.doc as unknown as Parameters<typeof TextSelection.create>[0];
          tr = tr.setSelection(TextSelection.create(selectionDoc, start + displayText.length));
          view.dispatch(tr);
          return true;
        }
        
        // Confirm active detected date on Tab before outline keymap handles indent
        if (event.key === "Tab") {
          const options = optionsRef.current;
          if (!options) {
            return false;
          }
          const pluginState = DATE_PLUGIN_KEY.getState(view.state);
          if (!pluginState?.isActive || !pluginState.detectedDate) {
            return false;
          }
          // Ensure we have a valid position; if missing, derive it around the caret
          let position = pluginState.position;
          if (!position) {
            const { state } = view;
            const head = state.selection.head;
            const windowStart = Math.max(0, head - 100);
            const windowEnd = Math.min(state.doc.content.size, head + 100);
            const windowText = state.doc.textBetween(windowStart, windowEnd, "\n", "\n");
            const index = windowText.indexOf(pluginState.detectedText);
            if (index >= 0) {
              position = { from: windowStart + index, to: windowStart + index + pluginState.detectedText.length };
            } else {
              return false;
            }
          }
          event.preventDefault();
          const clearTr = view.state.tr.setMeta(DATE_PLUGIN_KEY, {
            detectedDate: null,
            detectedText: "",
            position: null,
            isActive: false
          });
          view.dispatch(clearTr);
          options.onDateConfirmed?.(pluginState.detectedDate, pluginState.detectedText, position);
          return true;
        }
        
        return false;
      },
      
      handlePaste: (view, event, slice) => {
        const options = optionsRef.current;
        if (!options) {
          return false;
        }
        const text = slice.content.textBetween(0, slice.content.size, "\n", "\n");
        if (!text || text.length === 0) {
          return false;
        }
        const result = detectDateInText(text);
        if (!result) {
          return false;
        }
        const { from } = view.state.selection;
        const to = from + result.text.length;
        const tr = view.state.tr.setMeta(DATE_PLUGIN_KEY, {
          detectedDate: result.date,
          detectedText: result.text,
          position: { from, to },
          isActive: true
        });
        view.dispatch(tr);
        options.onDateDetected?.(result.date, result.text, { from, to });
        return false;
      },
      handleTextInput: (view: EditorView, from: number, to: number, text: string): boolean => {
        const options = optionsRef.current;
        if (!options) {
          return false;
        }
        // Skip detection if we're typing inside an existing date mark
        const { state } = view;
        const dateMark = state.schema.marks.date;
        if (dateMark) {
          const $from = state.selection.$from;
          const nodeBefore = $from.nodeBefore;
          if (nodeBefore && nodeBefore.marks.some((mark) => mark.type === dateMark)) {
            return false;
          }
        }
        
        // Get the current text content around the cursor
        const LOOK_BEHIND = 120;
        const windowStart = Math.max(0, from - LOOK_BEHIND);
        const textBefore = view.state.doc.textBetween(windowStart, from, "\n", "\n");
        const candidateSource = textBefore + text;
        
        const dateResult = detectDateEndingAtTextEnd(candidateSource);
        if (!dateResult) {
          return false;
        }
        
        const detectedTextStart = dateResult.startIndex;
        const detectedTextEnd = dateResult.endIndex;
        const actualFrom = windowStart + detectedTextStart;
        const actualTo = windowStart + detectedTextEnd;
        if (actualFrom < 0 || actualFrom >= actualTo) {
          return false;
        }
        
        if (dateMark && actualFrom < from) {
          const clampedTo = Math.min(from, actualTo, view.state.doc.content.size);
          if (clampedTo > actualFrom) {
            const markTypeForCheck = dateMark as unknown as Parameters<typeof view.state.doc.rangeHasMark>[2];
            if (view.state.doc.rangeHasMark(actualFrom, clampedTo, markTypeForCheck)) {
              return false;
            }
          }
        }
        
        const detectedText = candidateSource.slice(detectedTextStart, detectedTextEnd);
        
        console.log("Date plugin: Detected date at caret:", {
          chronoText: dateResult.text,
          detectedText,
          detectedTextStart,
          detectedTextEnd,
          actualFrom,
          actualTo
        });
        
        let tr = view.state.tr.setMeta(DATE_PLUGIN_KEY, {
          detectedDate: dateResult.date,
          detectedText,
          position: { from: actualFrom, to: actualTo },
          isActive: true
        });
        view.dispatch(tr);
        
        // Notify about the detected date
        options.onDateDetected?.(dateResult.date, dateResult.text, { from: actualFrom, to: actualTo });
        
        return false; // Don't prevent the text input
      },
      
      // (Tab confirmation handled in unified handleKeyDown above)
    }
  });
};

// Optional: helper to read plugin state
export const getDateDetectionState = (state: EditorState): DateDetectionPluginState | null => {
  return DATE_PLUGIN_KEY.getState(state) ?? null;
};

/**
 * Applies a date tag to the editor at the specified position
 */
export const applyDateTag = (
  view: EditorView,
  date: Date,
  displayText: string,
  hasTime: boolean,
  position: { from: number; to: number }
): boolean => {
  const schema = view.state.schema;
  const dateMarkType = schema.marks.date;
  
  if (!dateMarkType) {
    return false;
  }
  
  // Validate position bounds
  const docSize = view.state.doc.content.size;
  if (position.from < 0 || position.to > docSize || position.from >= position.to) {
    console.log("Date plugin: Invalid position in applyDateTag:", position);
    return false;
  }
  
  // Verify that the text at the position matches what we expect to replace
  const textAtPosition = view.state.doc.textBetween(position.from, position.to, "\n", "\n");
  console.log("Date plugin: Replacing text:", textAtPosition, "at position:", position);
  
  // Use the provided displayText instead of calling formatDate again
  const formattedText = displayText;
  const dateMark = dateMarkType.create({
    date: date.toISOString(),
    displayText: formattedText,
    hasTime
  });
  
  const taggedText = schema.text(formattedText, [dateMark]) as unknown as Parameters<Transaction["replaceWith"]>[2];
  
  let transaction = view.state.tr.replaceWith(position.from, position.to, taggedText);
  
  // Handle spacing before the date tag (unless at start of document)
  const tagStart = position.from;
  if (tagStart > 0) {
    const prevChar = transaction.doc.textBetween(tagStart - 1, tagStart, "\n", "\n");
    if (prevChar !== " ") {
      transaction = transaction.insertText(" ", tagStart);
      // Adjust the tag end position since we inserted a space
      const tagEnd = tagStart + 1 + formattedText.length;
      
      // Ensure there's a space after the date tag
      const nextChar = transaction.doc.textBetween(tagEnd, tagEnd + 1, "\n", "\n");
      if (nextChar !== " ") {
        transaction = transaction.insertText(" ", tagEnd);
      }
      
      // Set cursor position after the space
      const finalPosition = tagEnd + (nextChar !== " " ? 1 : 0);
      transaction = transaction.setSelection(
        TextSelection.create(transaction.doc as unknown as Parameters<typeof TextSelection.create>[0], finalPosition)
      );
    } else {
      // Space already exists before, just handle after
      const tagEnd = tagStart + formattedText.length;
      const nextChar = transaction.doc.textBetween(tagEnd, tagEnd + 1, "\n", "\n");
      if (nextChar !== " ") {
        transaction = transaction.insertText(" ", tagEnd);
      }
      
      // Set cursor position after the space
      const finalPosition = tagEnd + (nextChar !== " " ? 1 : 0);
      transaction = transaction.setSelection(
        TextSelection.create(transaction.doc as unknown as Parameters<typeof TextSelection.create>[0], finalPosition)
      );
    }
  } else {
    // At start of document, only handle spacing after
    const tagEnd = tagStart + formattedText.length;
    const nextChar = transaction.doc.textBetween(tagEnd, tagEnd + 1, "\n", "\n");
    if (nextChar !== " ") {
      transaction = transaction.insertText(" ", tagEnd);
    }
    
    // Set cursor position after the space
    const finalPosition = tagEnd + (nextChar !== " " ? 1 : 0);
    transaction = transaction.setSelection(
      TextSelection.create(transaction.doc as unknown as Parameters<typeof TextSelection.create>[0], finalPosition)
    );
  }
  
  view.dispatch(transaction);
  view.focus();
  
  return true;
};
