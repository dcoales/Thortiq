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

// (formatting handled by the host; plugin avoids format dependencies)

/**
 * Detects natural language dates in the given text
 */
const detectDateInText = (text: string): { date: Date; text: string; hasTime: boolean } | null => {
  const results = chrono.parse(text);
  if (results.length === 0) {
    return null;
  }
  
  const result = results[0];
  const date = result.start.date();
  const hasTime = result.start.isCertain('hour') || result.start.isCertain('minute');
  
  return {
    date,
    text: result.text,
    hasTime
  };
};

/**
 * Creates the date detection plugin
 */
export const createDateDetectionPlugin = (optionsRef: DateDetectionOptionsRef): Plugin<DateDetectionPluginState> => {
  return new Plugin({
    key: DATE_PLUGIN_KEY,
    state: {
      init: (): DateDetectionPluginState => ({
        detectedDate: null,
        detectedText: "",
        position: null,
        isActive: false
      }),
      
      apply: (tr: Transaction, value: DateDetectionPluginState): DateDetectionPluginState => {
        // Check for date detection metadata first
        const dateDetectionMeta = tr.getMeta(DATE_PLUGIN_KEY);
        if (dateDetectionMeta) {
          console.log("Date plugin: Applying metadata:", dateDetectionMeta);
          return {
            detectedDate: dateDetectionMeta.detectedDate,
            detectedText: dateDetectionMeta.detectedText,
            position: dateDetectionMeta.position,
            isActive: dateDetectionMeta.isActive !== false
          };
        }
        
        // If we have an active date detection, check if it's still valid
        if (value.isActive && value.position) {
          // Map the position through the transaction to see if it's still valid
          const mappedFrom = tr.mapping.map(value.position.from);
          const mappedTo = tr.mapping.map(value.position.to);
          
          // Check if the mapped position is still valid
          if (mappedFrom >= 0 && mappedTo <= tr.doc.content.size && mappedFrom < mappedTo) {
            // Check if the text at the mapped position still matches our detected text
            const textAtPosition = tr.doc.textBetween(mappedFrom, mappedTo, "\n", "\n");
            if (textAtPosition === value.detectedText) {
              console.log("Date plugin: Preserving active state - text still matches");
              return {
                ...value,
                position: { from: mappedFrom, to: mappedTo }
              };
            } else {
              console.log("Date plugin: Deactivating - text no longer matches:", textAtPosition, "vs", value.detectedText);
              return {
                detectedDate: null,
                detectedText: "",
                position: null,
                isActive: false
              };
            }
          } else {
            console.log("Date plugin: Deactivating - position no longer valid");
            return {
              detectedDate: null,
              detectedText: "",
              position: null,
              isActive: false
            };
          }
        }
        
        return value;
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
          // Always extend end by +1 (clamped) per UX directive
          const extendedTo = Math.min(view.state.doc.content.size, position.to + 1);
          const confirmedPosition = { from: position.from, to: extendedTo };
          const clearTr = view.state.tr.setMeta(DATE_PLUGIN_KEY, {
            detectedDate: null,
            detectedText: "",
            position: null,
            isActive: false
          });
          view.dispatch(clearTr);
          options.onDateConfirmed?.(pluginState.detectedDate, pluginState.detectedText, confirmedPosition);
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
        const textBefore = view.state.doc.textBetween(Math.max(0, from - 50), from, " ", " ");
        const textAfter = view.state.doc.textBetween(from, Math.min(view.state.doc.content.size, from + 50), " ", " ");
        const fullText = textBefore + text + textAfter;
        
        // Detect date in the recent text
        const dateResult = detectDateInText(fullText);
        if (!dateResult) {
          return false;
        }
        
        // Find the position of the detected text within the composed fullText
        const detectedTextStart = fullText.indexOf(dateResult.text);
        if (detectedTextStart === -1) {
          return false;
        }
        
        // Map indices in the composed string (textBefore + typed + textAfter) back to
        // document positions BEFORE the typed text is applied.
        const textBeforeStart = Math.max(0, from - 50);
        const beforeLen = textBefore.length;
        const insertedLen = text.length;
        const detectionStartIdx = detectedTextStart;
        const detectionEndIdx = detectionStartIdx + dateResult.text.length;

        const mapIndexToDoc = (idx: number): number => {
          // We want [actualFrom, actualTo) to cover exact characters of the detected text in the
          // eventual doc after this text input is applied. That means indices inside the typed
          // segment should map into the post-insert doc starting at `from`.
          if (idx <= beforeLen) {
            return textBeforeStart + idx;
          }
          if (idx <= beforeLen + insertedLen) {
            return from + (idx - beforeLen);
          }
          return textBeforeStart + idx - insertedLen;
        };

        const actualFrom = mapIndexToDoc(detectionStartIdx);
        const actualTo = mapIndexToDoc(detectionEndIdx);
        
        // Note: Text input is applied after this handler; positions may be outside current doc
        // bounds momentarily. We'll rely on transaction mapping in apply() to keep them aligned.
        
        console.log("Date plugin: Detected date:", {
          text: dateResult.text,
          detectedTextStart,
          actualFrom,
          actualTo,
          fullText: fullText.substring(0, 100) + "...",
          textBefore: textBefore.substring(0, 50) + "...",
          textAfter: textAfter.substring(0, 50) + "..."
        });
        
        // Update plugin state to mark date as detected
        let tr = view.state.tr.setMeta(DATE_PLUGIN_KEY, {
          detectedDate: dateResult.date,
          detectedText: dateResult.text,
          position: { from: actualFrom, to: actualTo },
          isActive: true
        });
        // If user typed a suffix beyond detectedText (e.g., "thur" where detection matched "thu"),
        // include the current head within the range when it still forms the same token.
        const head = view.state.selection.head;
        if (head > actualTo) {
          const candidate = view.state.doc.textBetween(actualFrom, head, "\n", "\n");
          // If the candidate still starts with detected text, expand position to head
          if (candidate.startsWith(dateResult.text)) {
            tr = tr.setMeta(DATE_PLUGIN_KEY, {
              detectedDate: dateResult.date,
              detectedText: candidate,
              position: { from: actualFrom, to: head },
              isActive: true
            });
          }
        }
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
