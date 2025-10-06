/**
 * TagDialog renders the inline tag suggestion list anchored to the current caret.
 * It filters existing tags by query and trigger character (# or @), allowing users
 * to select from recently used tags or create new ones.
 */
import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";

import { getTagBackgroundColor, getTagTextColor } from "@thortiq/client-core";

export interface TagCandidate {
  readonly name: string;
  readonly triggerChar: "#" | "@";
}

interface TagDialogProps {
  readonly anchor: {
    readonly left: number;
    readonly bottom: number;
  };
  readonly query: string;
  readonly triggerChar: "#" | "@";
  readonly existingTags: ReadonlyArray<string>;
  readonly selectedIndex: number;
  readonly onSelect: (tagName: string) => void;
  readonly onHoverIndexChange?: (index: number) => void;
  readonly onRequestClose?: () => void;
}

const DIALOG_MAX_WIDTH = 280;
const DIALOG_MAX_HEIGHT = 240;

export const TagDialog = ({
  anchor,
  query,
  triggerChar,
  existingTags,
  selectedIndex,
  onSelect,
  onHoverIndexChange,
  onRequestClose
}: TagDialogProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const positioning = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        left: anchor.left,
        top: anchor.bottom + 4
      };
    }
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.max(8, Math.min(anchor.left, viewportWidth - DIALOG_MAX_WIDTH - 8));
    const top = Math.max(8, Math.min(anchor.bottom + 4, viewportHeight - DIALOG_MAX_HEIGHT - 8));
    return { left, top };
  }, [anchor.bottom, anchor.left]);

  // Filter existing tags by trigger character AND query text
  // Show "create new" option ONLY when no existing tags match
  const filteredTags = useMemo(() => {
    const lowerQuery = query.toLowerCase();
    
    // Tags in metadata include the trigger character
    const filtered = existingTags
      .filter((tag) => {
        // Only show tags that start with the correct trigger character
        if (!tag.startsWith(triggerChar)) {
          return false;
        }
        // If no query, show all tags with this trigger
        if (query.length === 0) {
          return true;
        }
        // Filter by query - remove trigger character for matching
        const tagName = tag.substring(1);
        return tagName.toLowerCase().includes(lowerQuery);
      });
    // Note: existingTags are already sorted by most recent usage
    
    // If user has typed something and NO existing tags match, show create option
    if (query.length > 0 && filtered.length === 0) {
      const fullTag = triggerChar + query;
      return [fullTag];
    }
    
    return filtered;
  }, [existingTags, query, triggerChar]);

  useEffect(() => {
    if (!onRequestClose) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current) {
        return;
      }
      if (containerRef.current.contains(event.target as Node)) {
        return;
      }
      onRequestClose();
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [onRequestClose]);

  useEffect(() => {
    const element = itemRefs.current[selectedIndex];
    element?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, filteredTags.length]);

  itemRefs.current = [];

  const containerStyle: CSSProperties = {
    position: "fixed",
    left: positioning.left,
    top: positioning.top,
    minWidth: "200px",
    maxWidth: `${DIALOG_MAX_WIDTH}px`,
    maxHeight: `${DIALOG_MAX_HEIGHT}px`,
    overflow: "hidden",
    borderRadius: "0.75rem",
    border: "1px solid rgba(148, 163, 184, 0.28)",
    boxShadow: "0 20px 45px rgba(15, 23, 42, 0.18)",
    backgroundColor: "#ffffff",
    zIndex: 2000,
    padding: "4px 0",
    display: "flex",
    flexDirection: "column"
  };

  const listStyle: CSSProperties = {
    listStyle: "none",
    margin: 0,
    padding: 0,
    overflowY: "auto",
    maxHeight: `${DIALOG_MAX_HEIGHT - 16}px`
  };

  const baseItemStyle: CSSProperties = {
    width: "100%",
    padding: "8px 14px",
    textAlign: "left",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "8px"
  };

  const emptyStateStyle: CSSProperties = {
    padding: "12px 16px",
    color: "#6b7280",
    fontSize: "0.85rem"
  };

  return (
    <div ref={containerRef} style={containerStyle} data-outline-tag-dialog="true">
      {filteredTags.length === 0 ? (
        <div style={emptyStateStyle}>
          {query.length > 0 
            ? `Press Enter to create ${triggerChar}${query}` 
            : `Type to create a new tag`}
        </div>
      ) : (
        <ul style={listStyle} role="listbox" aria-label="Tag suggestions">
          {filteredTags.map((tag, index) => {
            const isSelected = index === selectedIndex;
            const tagName = tag.substring(1); // Remove trigger character
            const backgroundColor = getTagBackgroundColor(tagName);
            const textColor = getTagTextColor(tagName);
            
            const itemStyle = isSelected
              ? {
                  ...baseItemStyle,
                  backgroundColor: "#eef2ff"
                }
              : baseItemStyle;
              
            const tagPillStyle: CSSProperties = {
              padding: "2px 8px",
              borderRadius: "12px",
              fontSize: "0.85em",
              backgroundColor,
              color: textColor,
              display: "inline-block"
            };
            
            return (
              <li key={`${tag}-${index}`}>
                <button
                  type="button"
                  style={itemStyle}
                  role="option"
                  aria-selected={isSelected}
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  onMouseEnter={() => onHoverIndexChange?.(index)}
                  onClick={(event) => {
                    event.preventDefault();
                    onSelect(tagName);
                  }}
                >
                  <span style={tagPillStyle}>{tag}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};



