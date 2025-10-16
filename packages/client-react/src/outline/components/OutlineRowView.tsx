/**
 * Presentational outline row renderer that maps shared row state into DOM-ready markup.
 * Handles focus, collapse toggles, drag handles, and presence display without mutating state.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";

import type {
  EdgeId,
  InlineSpan,
  NodeHeadingLevel,
  NodeId,
  TagTrigger
} from "@thortiq/client-core";
import type { OutlinePresenceParticipant } from "@thortiq/client-core";
import type { FocusPanePayload } from "@thortiq/sync-core";

import type { OutlineRow } from "../useOutlineRows";
import type { DropIndicatorDescriptor } from "../useOutlineDragAndDrop";
import type { OutlineSingletonRole } from "../contextMenu/contextMenuEvents";
import { PresenceIndicators } from "./PresenceIndicators";

export const MIRROR_ORIGINAL_COLOR = "#cb8756ff";
export const MIRROR_INSTANCE_COLOR = "#839ed7ff";

export const OUTLINE_ROW_TOGGLE_DIAMETER_REM = 0.8;
export const OUTLINE_ROW_BULLET_DIAMETER_REM = 1;
// Shared spacing tokens keep row spacing predictable for single and multi-line text.
export const OUTLINE_ROW_LINE_HEIGHT_REM = 1.4;
export const OUTLINE_ROW_BOTTOM_PADDING_REM = 0.5;
export const OUTLINE_ROW_CONTROL_VERTICAL_OFFSET_REM =
  OUTLINE_ROW_LINE_HEIGHT_REM / 2 - OUTLINE_ROW_BULLET_DIAMETER_REM / 2;
export const OUTLINE_ROW_GUIDELINE_SPACER_REM = OUTLINE_ROW_TOGGLE_DIAMETER_REM;
export const OUTLINE_ROW_GUIDELINE_COLUMN_REM = OUTLINE_ROW_BULLET_DIAMETER_REM;

const HEADING_STYLE_BY_LEVEL: Record<NodeHeadingLevel, CSSProperties> = {
  1: { fontSize: "1.6rem", fontWeight: 700, lineHeight: "1.25" },
  2: { fontSize: "1.45rem", fontWeight: 700, lineHeight: "1.25" },
  3: { fontSize: "1.3rem", fontWeight: 700, lineHeight: "1.25" },
  4: { fontSize: "1.15rem", fontWeight: 700, lineHeight: "1.25" },
  5: { fontSize: "1rem", fontWeight: 700, lineHeight: "1.25" }
};

interface OutlineGuidelineLayerProps {
  readonly row: OutlineRow;
  readonly hoveredEdgeId: EdgeId | null;
  readonly onPointerEnter?: (edgeId: EdgeId) => void;
  readonly onPointerLeave?: (edgeId: EdgeId) => void;
  readonly onClick?: (edgeId: EdgeId) => void;
  readonly getLabel?: (edgeId: EdgeId) => string;
}

const OutlineGuidelineLayer = ({
  row,
  hoveredEdgeId,
  onPointerEnter,
  onPointerLeave,
  onClick,
  getLabel
}: OutlineGuidelineLayerProps): JSX.Element | null => {
  if (row.depth <= 0) {
    return null;
  }

  const columnCount = row.depth;
  const effectiveAncestors = row.ancestorEdgeIds.slice(-columnCount);
  const columns: Array<EdgeId | null> = [];
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    const ancestorIndex = effectiveAncestors.length - columnCount + columnIndex;
    columns.push(ancestorIndex >= 0 ? effectiveAncestors[ancestorIndex] ?? null : null);
  }

  return (
    <div
      style={rowStyles.guidelineContainer}
      aria-hidden={columns.every((edgeId) => edgeId === null)}
      data-outline-guideline-layer="true"
    >
      {columns.map((edgeId, index) => {
        const keyBase = `guideline-${row.edgeId}-${index}`;
        if (!edgeId) {
          return (
            <div key={`${keyBase}-empty`} style={rowStyles.guidelinePair} aria-hidden>
              <span style={rowStyles.guidelineSpacer} aria-hidden />
              <span style={rowStyles.guidelinePlaceholder} aria-hidden />
            </div>
          );
        }

        const hovered = hoveredEdgeId === edgeId;
        const label = getLabel ? getLabel(edgeId) : "Toggle children";

        return (
          <div key={`${keyBase}-populated`} style={rowStyles.guidelinePair}>
            <span style={rowStyles.guidelineSpacer} aria-hidden />
            <button
              type="button"
              style={rowStyles.guidelineButton}
              data-outline-guideline="true"
              onPointerEnter={onPointerEnter ? () => onPointerEnter(edgeId) : undefined}
              onPointerLeave={onPointerLeave ? () => onPointerLeave(edgeId) : undefined}
              onClick={onClick ? () => onClick(edgeId) : undefined}
              aria-label={label}
            >
              <span
                style={{
                  ...rowStyles.guidelineLine,
                  ...(hovered ? rowStyles.guidelineLineHovered : undefined)
                }}
                aria-hidden
              />
            </button>
          </div>
        );
      })}
    </div>
  );
};

interface OutlineInlineContentProps {
  readonly spans: ReadonlyArray<InlineSpan>;
  readonly edgeId: EdgeId;
  readonly sourceNodeId: NodeId;
  readonly headingLevel?: NodeHeadingLevel;
  readonly onWikiLinkClick?: OutlineRowViewProps["onWikiLinkClick"];
  readonly onWikiLinkHover?: OutlineRowViewProps["onWikiLinkHover"];
  readonly onTagClick?: OutlineRowViewProps["onTagClick"];
  readonly onDatePillClick?: (payload: {
    readonly element: HTMLElement;
    readonly segmentIndex: number;
    readonly value: string | null;
    readonly displayText: string;
    readonly hasTime: boolean;
  }) => void;
}

const OutlineInlineContent = ({
  spans,
  edgeId,
  sourceNodeId,
  headingLevel,
  onWikiLinkClick,
  onWikiLinkHover,
  onTagClick,
  onDatePillClick
}: OutlineInlineContentProps): JSX.Element => {
  const deriveMarkPresentation = (marks: ReadonlyArray<InlineSpan["marks"][number]>) => {
    const style: CSSProperties = {};
    const dataAttrs: Record<string, string> = {};
    const textDecorations = new Set<string>();
    const isHeading = typeof headingLevel === "number";

    marks.forEach((mark) => {
      switch (mark.type) {
        case "strong":
          style.fontWeight = isHeading ? 700 : 600;
          dataAttrs["data-outline-mark-strong"] = "true";
          break;
        case "em":
          style.fontStyle = "italic";
          dataAttrs["data-outline-mark-em"] = "true";
          break;
        case "underline":
          textDecorations.add("underline");
          dataAttrs["data-outline-mark-underline"] = "true";
          break;
        case "strikethrough":
          textDecorations.add("line-through");
          dataAttrs["data-outline-mark-strikethrough"] = "true";
          break;
        case "textColor": {
          const color = (mark.attrs as { color?: unknown } | undefined)?.color;
          if (typeof color === "string" && color.length > 0) {
            const normalized = color.toLowerCase();
            style.color = normalized;
            dataAttrs["data-outline-mark-text-color"] = normalized;
          }
          break;
        }
        case "backgroundColor": {
          const color = (mark.attrs as { color?: unknown } | undefined)?.color;
          if (typeof color === "string" && color.length > 0) {
            const normalized = color.toLowerCase();
            style.backgroundColor = normalized;
            dataAttrs["data-outline-mark-background-color"] = normalized;
          }
          break;
        }
        default:
          break;
      }
    });

    if (textDecorations.size > 0) {
      style.textDecoration = Array.from(textDecorations).join(" ");
    }

    dataAttrs["data-outline-inline-span"] = "true";
    return { style, dataAttrs };
  };

  return (
    <>
      {spans.map((span, index) => {
        // Render date pills in static HTML view
        const dateMark = span.marks.find((mark) => mark.type === "date");
        if (dateMark) {
          const attrs = dateMark.attrs as { date?: unknown; displayText?: unknown; hasTime?: unknown };
          const dateValue = typeof attrs.date === "string" ? attrs.date : undefined;
          const displayText = typeof attrs.displayText === "string" && attrs.displayText.length > 0 ? attrs.displayText : span.text;
          const hasTime = String(attrs.hasTime) === "true";
          return (
            <button
              key={`inline-date-${index}`}
              type="button"
              style={rowStyles.dateButton}
              data-date="true"
              data-date-value={dateValue}
              data-date-display={displayText}
              data-date-has-time={hasTime ? "true" : "false"}
              data-outline-date-index={String(index)}
              data-date-pill="true"
              aria-label={displayText}
              title={displayText}
              onPointerDownCapture={(event) => {
                event.stopPropagation();
              }}
              onMouseDownCapture={(event) => {
                event.stopPropagation();
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDatePillClick?.({
                  element: event.currentTarget,
                  segmentIndex: index,
                  value: dateValue ?? null,
                  displayText,
                  hasTime
                });
              }}
            >
              {displayText}
            </button>
          );
        }
        const tagMark = span.marks.find((mark) => mark.type === "tag");
        if (tagMark) {
          const attrs = tagMark.attrs as { id?: unknown; trigger?: unknown; label?: unknown };
          const trigger = attrs.trigger === "@" ? "@" : "#";
          const label = typeof attrs.label === "string" && attrs.label.length > 0 ? attrs.label : span.text;
          const displayText = `${trigger}${label}`;
          const tagStyle =
            trigger === "@"
              ? { ...rowStyles.tagPill, ...rowStyles.tagPillMention }
              : rowStyles.tagPill;
          const resolvedTrigger: TagTrigger = trigger === "@" ? "@" : "#";
          return (
            <button
              key={`inline-tag-${index}`}
              type="button"
              style={rowStyles.tagButton}
              data-outline-tag="true"
              data-tag-id={typeof attrs.id === "string" ? attrs.id : undefined}
              data-tag-trigger={trigger}
              data-tag-label={label}
              aria-label={displayText}
              title={displayText}
              onPointerDownCapture={(event) => {
                event.stopPropagation();
              }}
              onMouseDownCapture={(event) => {
                event.stopPropagation();
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.focus();
              }}
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onTagClick?.({
                  edgeId,
                  sourceNodeId,
                  label,
                  trigger: resolvedTrigger
                });
              }}
            >
              <span style={tagStyle}>{displayText}</span>
            </button>
          );
        }
        const wikiMark = span.marks.find((mark) => mark.type === "wikilink");
        const nodeIdValue = wikiMark
          ? (wikiMark.attrs as { nodeId?: unknown }).nodeId
          : undefined;
        const targetNodeId = typeof nodeIdValue === "string" ? (nodeIdValue as NodeId) : null;
        if (targetNodeId) {
          return (
            <button
              key={`inline-${index}`}
              type="button"
              style={rowStyles.wikiLink}
              data-outline-wikilink="true"
              data-target-node-id={targetNodeId}
              data-outline-wikilink-index={index}
              onPointerDownCapture={(event) => {
                event.stopPropagation();
              }}
              onMouseDownCapture={(event) => {
                event.stopPropagation();
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.focus();
              }}
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onWikiLinkClick?.({
                  edgeId,
                  sourceNodeId,
                  targetNodeId,
                  displayText: span.text,
                  segmentIndex: index,
                  event
                });
              }}
              onMouseEnter={(event) => {
                if (!onWikiLinkHover) {
                  return;
                }
                onWikiLinkHover({
                  type: "enter",
                  edgeId,
                  sourceNodeId,
                  targetNodeId,
                  displayText: span.text,
                  segmentIndex: index,
                  element: event.currentTarget
                });
              }}
              onMouseLeave={(event) => {
                if (!onWikiLinkHover) {
                  return;
                }
                onWikiLinkHover({
                  type: "leave",
                  edgeId,
                  sourceNodeId,
                  targetNodeId,
                  displayText: span.text,
                  segmentIndex: index,
                  element: event.currentTarget
                });
              }}
            >
              {span.text}
            </button>
          );
        }
        const { style, dataAttrs } = deriveMarkPresentation(span.marks);
        return (
          <span key={`inline-${index}`} style={style} {...dataAttrs}>
            {span.text}
          </span>
        );
      })}
    </>
  );
};

const isWikiLinkEvent = (target: EventTarget | null): target is HTMLElement => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest('[data-outline-wikilink="true"]'));
};

const resolveTagElement = (target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  return target.closest<HTMLElement>("[data-outline-tag]");
};

const resolveDatePillElement = (target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  return target.closest<HTMLElement>('[data-date="true"]');
};

export interface OutlineMirrorIndicatorClickPayload {
  readonly row: OutlineRow;
  readonly target: HTMLButtonElement;
}

export interface OutlineRowViewProps {
  readonly row: OutlineRow;
  readonly isSelected: boolean;
  readonly isPrimarySelected: boolean;
  readonly highlightSelected: boolean;
  readonly editorEnabled: boolean;
  readonly editorAttachedEdgeId: EdgeId | null;
  readonly isActivePane: boolean;
  readonly presence: readonly OutlinePresenceParticipant[];
  readonly dropIndicator?: DropIndicatorDescriptor | null;
  readonly hoveredGuidelineEdgeId?: EdgeId | null;
  readonly onSelect: (edgeId: EdgeId) => void;
  readonly onFocusEdge?: (payload: FocusPanePayload) => void;
  readonly onToggleCollapsed: (edgeId: EdgeId, collapsed?: boolean) => void;
  readonly onToggleTodo?: (edgeId: EdgeId) => void;
  readonly onRowMouseDown?: (event: ReactMouseEvent<HTMLDivElement>, edgeId: EdgeId) => void;
  readonly onRowPointerDownCapture?: (
    event: ReactPointerEvent<HTMLDivElement>,
    edgeId: EdgeId
  ) => void;
  readonly onRowContextMenu?: (event: ReactMouseEvent<HTMLDivElement>, edgeId: EdgeId) => void;
  readonly onDragHandlePointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    edgeId: EdgeId
  ) => void;
  readonly onActiveTextCellChange?: (edgeId: EdgeId, element: HTMLDivElement | null) => void;
  readonly onGuidelinePointerEnter?: (edgeId: EdgeId) => void;
  readonly onGuidelinePointerLeave?: (edgeId: EdgeId) => void;
  readonly onGuidelineClick?: (edgeId: EdgeId) => void;
  readonly getGuidelineLabel?: (edgeId: EdgeId) => string;
  readonly onBulletActivate?: (payload: {
    readonly edgeId: EdgeId;
    readonly pathEdgeIds: readonly EdgeId[];
    readonly event: ReactMouseEvent<HTMLButtonElement>;
  }) => boolean | void;
  readonly onWikiLinkClick?: (payload: {
    readonly edgeId: EdgeId;
    readonly sourceNodeId: NodeId;
    readonly targetNodeId: NodeId;
    readonly displayText: string;
    readonly segmentIndex: number;
    readonly event: ReactMouseEvent<HTMLButtonElement>;
  }) => void;
  readonly onWikiLinkHover?: (payload: {
    readonly type: "enter" | "leave";
    readonly edgeId: EdgeId;
    readonly sourceNodeId: NodeId;
    readonly targetNodeId: NodeId;
    readonly displayText: string;
    readonly segmentIndex: number;
    readonly element: HTMLElement;
  }) => void;
  readonly onTagClick?: (payload: {
    readonly edgeId: EdgeId;
    readonly sourceNodeId: NodeId;
    readonly label: string;
    readonly trigger: TagTrigger;
  }) => void;
  readonly onMirrorIndicatorClick?: (payload: OutlineMirrorIndicatorClickPayload) => void;
  readonly activeMirrorIndicatorEdgeId?: EdgeId | null;
  readonly singletonRole?: OutlineSingletonRole | null;
  readonly onDateClick?: (payload: OutlineDateClickPayload) => void;
}

export interface OutlineDateClickPayload {
  readonly edgeId: EdgeId;
  readonly sourceNodeId: NodeId;
  readonly segmentIndex: number | null;
  readonly value: string | null;
  readonly displayText: string;
  readonly hasTime: boolean;
  readonly anchor: {
    readonly left: number;
    readonly top: number;
    readonly bottom: number;
  };
  readonly position?: { readonly from: number; readonly to: number } | null;
}

export const OutlineRowView = ({
  row,
  isSelected,
  isPrimarySelected,
  onFocusEdge,
  highlightSelected,
  editorAttachedEdgeId,
  onSelect,
  onToggleCollapsed,
  onToggleTodo,
  onRowMouseDown,
  onRowPointerDownCapture,
  onRowContextMenu,
  onDragHandlePointerDown,
  onActiveTextCellChange,
  editorEnabled,
  isActivePane,
  presence,
  dropIndicator,
  hoveredGuidelineEdgeId,
  onGuidelinePointerEnter,
  onGuidelinePointerLeave,
  onGuidelineClick,
  getGuidelineLabel,
  onBulletActivate,
  onWikiLinkClick,
  onWikiLinkHover,
  onTagClick,
  onMirrorIndicatorClick,
  activeMirrorIndicatorEdgeId,
  singletonRole: singletonRoleProp,
  onDateClick
}: OutlineRowViewProps): JSX.Element => {
  const singletonRole = singletonRoleProp ?? null;
  const textCellRef = useRef<HTMLDivElement | null>(null);
  const isDone = row.metadata.todo?.done ?? false;
  const rawText = row.text ?? "";
  const trimmedText = rawText.trim();
  const nodeLabel = trimmedText.length > 0 ? trimmedText : null;
  const isPlaceholder = trimmedText.length === 0;

  const headingLevel = row.metadata.headingLevel ?? null;
  const headingStyle = headingLevel ? HEADING_STYLE_BY_LEVEL[headingLevel] : undefined;

  const shouldHideStaticText =
    editorEnabled && isActivePane && editorAttachedEdgeId === row.edgeId;

  const isMirror = row.mirrorOfNodeId !== null;
  const hasMirrorInstances = !isMirror && row.mirrorCount > 0;
  const haloColor = isMirror
    ? MIRROR_INSTANCE_COLOR
    : hasMirrorInstances
      ? MIRROR_ORIGINAL_COLOR
      : null;
  const bulletHaloVariant = haloColor ? (isMirror ? "mirror" : "original") : null;
  const shouldRenderMirrorIndicator = isMirror || row.mirrorCount > 0;
  const mirrorIndicatorValue = isMirror ? Math.max(1, row.mirrorCount) : row.mirrorCount;
  const mirrorIndicatorColor = isMirror ? MIRROR_INSTANCE_COLOR : MIRROR_ORIGINAL_COLOR;
  const mirrorIndicatorActive = (activeMirrorIndicatorEdgeId ?? null) === row.edgeId;
  const mirrorIndicatorLabel = shouldRenderMirrorIndicator
    ? `View ${mirrorIndicatorValue} mirror location${mirrorIndicatorValue === 1 ? "" : "s"}${
        nodeLabel ? ` for ${nodeLabel}` : ""
      }`
    : "";
  const mirrorIndicatorNode = shouldRenderMirrorIndicator ? (
    <div style={rowStyles.rightRailCell}>
      <button
        type="button"
        style={{
          ...rowStyles.mirrorBadgeButton,
          border: `2px solid ${mirrorIndicatorColor}`,
          color: mirrorIndicatorColor,
          ...(mirrorIndicatorActive ? rowStyles.mirrorBadgeActive : undefined)
        }}
        data-outline-mirror-indicator="true"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onMirrorIndicatorClick?.({ row, target: event.currentTarget });
        }}
        aria-label={mirrorIndicatorLabel}
      >
        <span style={rowStyles.mirrorBadgeText}>{mirrorIndicatorValue}</span>
      </button>
    </div>
  ) : null;

  const renderInlineContent = (): JSX.Element | string => {
    if (row.inlineContent.length === 0) {
      return rawText;
    }
    return (
      <OutlineInlineContent
        key="inline"
        spans={row.inlineContent}
        edgeId={row.edgeId}
        sourceNodeId={row.nodeId}
        headingLevel={headingLevel ?? undefined}
        onWikiLinkClick={onWikiLinkClick}
        onWikiLinkHover={onWikiLinkHover}
        onTagClick={onTagClick}
        onDatePillClick={onDateClick ? handleDatePillClick : undefined}
      />
    );
  };

  const singletonBadgeLabel = singletonRole === "inbox"
    ? "Inbox node"
    : singletonRole === "journal"
      ? "Journal node"
      : null;

  const singletonBadgeGlyph = singletonRole === "inbox"
    ? (
        <svg
          viewBox="0 0 24 24"
          style={rowStyles.singletonBadgeGlyph}
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M4 5h16l1 6v8H3V11l1-6zm0 6v6h16v-6h-4.8a3.2 3.2 0 01-6.4 0H4z"
            fill="currentColor"
            fillRule="evenodd"
          />
        </svg>
      )
    : singletonRole === "journal"
      ? (
          <svg
            viewBox="0 0 24 24"
            style={rowStyles.singletonBadgeGlyph}
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M6 4h10.5c1.1 0 1.93.9 1.93 2v12c0 1.1-.83 2-1.93 2H6a2 2 0 01-2-2V6a2 2 0 012-2zm0 2v12h10.5V6H6zm2 1h6.5v2H8V7zm0 4h4v1.5H8V11z"
              fill="currentColor"
              fillRule="evenodd"
            />
          </svg>
        )
      : null;

  const singletonBadgeNode = singletonRole && singletonBadgeLabel && singletonBadgeGlyph
    ? (
        <span
          style={{
            ...rowStyles.singletonBadge,
            ...(singletonRole === "journal"
              ? rowStyles.singletonBadgeJournal
              : rowStyles.singletonBadgeInbox)
          }}
          role="img"
          aria-label={singletonBadgeLabel}
          data-outline-singleton={singletonRole}
        >
          {singletonBadgeGlyph}
        </span>
      )
    : null;
  const selectionBackground = isSelected && highlightSelected
    ? isPrimarySelected
      ? "#eef2ff"
      : "#f3f4ff"
    : "transparent";
  const selectionBorder = isSelected && highlightSelected
    ? isPrimarySelected
      ? "3px solid #4f46e5"
      : "3px solid #c7d2fe"
    : "3px solid transparent";

  const textCellStyle = isDone
    ? { ...rowStyles.textCell, ...rowStyles.textCellDone }
    : rowStyles.textCell;
  const baseTextSpanStyle = isDone
    ? { ...rowStyles.rowText, ...rowStyles.rowTextDone }
    : rowStyles.rowText;
  const placeholderAdjustedStyle = isPlaceholder
    ? { ...baseTextSpanStyle, ...rowStyles.rowTextPlaceholder }
    : baseTextSpanStyle;
  const textSpanStyle = headingStyle
    ? { ...placeholderAdjustedStyle, ...headingStyle }
    : placeholderAdjustedStyle;

  const readTagMetadata = (element: HTMLElement): { label: string; trigger: TagTrigger } | null => {
    const triggerAttr = element.getAttribute("data-tag-trigger");
    const labelAttr = element.getAttribute("data-tag-label") ?? element.textContent ?? "";
    const normalizedLabel = labelAttr.trim();
    if (normalizedLabel.length === 0) {
      return null;
    }
    const trigger: TagTrigger = triggerAttr === "@" ? "@" : "#";
    return { label: normalizedLabel, trigger };
  };

  const handleDatePillClick = ({
    element,
    segmentIndex,
    value,
    displayText,
    hasTime
  }: {
    readonly element: HTMLElement;
    readonly segmentIndex: number;
    readonly value: string | null;
    readonly displayText: string;
    readonly hasTime: boolean;
  }) => {
    const rect = element.getBoundingClientRect();
    onDateClick?.({
      edgeId: row.edgeId,
      sourceNodeId: row.nodeId,
      segmentIndex,
      value,
      displayText,
      hasTime,
      anchor: {
        left: rect.left + rect.width / 2,
        top: rect.top,
        bottom: rect.bottom
      },
      position: null
    });
  };

  const handleStaticInlineClick = (event: ReactMouseEvent<HTMLSpanElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (!onTagClick) {
      return;
    }
    const tagElement = resolveTagElement(event.target);
    if (!tagElement) {
      return;
    }
    if (tagElement instanceof HTMLButtonElement) {
      return;
    }
    const metadata = readTagMetadata(tagElement);
    if (!metadata) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onTagClick({
      edgeId: row.edgeId,
      sourceNodeId: row.nodeId,
      label: metadata.label,
      trigger: metadata.trigger
    });
  };

  const textContentNode = (
    <span
      style={{
        ...textSpanStyle,
        display: shouldHideStaticText ? "none" : "inline"
      }}
      data-outline-text-content="true"
      data-outline-text-placeholder={isPlaceholder ? "true" : undefined}
      data-outline-heading-level={headingLevel ? String(headingLevel) : undefined}
      onClick={handleStaticInlineClick}
    >
      {renderInlineContent()}
    </span>
  );

  const layout = row.metadata.layout ?? "standard";
  const [isHovered, setIsHovered] = useState(false);

  useLayoutEffect(() => {
    setIsHovered(false);
  }, [layout, row.edgeId]);

  useLayoutEffect(() => {
    if (!onActiveTextCellChange) {
      return;
    }
    onActiveTextCellChange(row.edgeId, isSelected ? textCellRef.current : null);
    return () => {
      onActiveTextCellChange(row.edgeId, null);
    };
  }, [isSelected, onActiveTextCellChange, row.edgeId]);

  const handleToggleCollapsed = () => {
    if (!row.hasChildren) {
      return;
    }
    onToggleCollapsed(row.edgeId, !row.collapsed);
    onSelect(row.edgeId);
  };

  const handleBulletMouseDown = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleBulletClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const handled = onBulletActivate?.({
      edgeId: row.edgeId,
      pathEdgeIds: [...row.ancestorEdgeIds, row.edgeId],
      event
    });
    if (handled) {
      return;
    }
    if (!onFocusEdge) {
      return;
    }
    const pathEdgeIds = [...row.ancestorEdgeIds, row.edgeId];
    onFocusEdge({ edgeId: row.edgeId, pathEdgeIds });
  };

  const isParagraph = layout === "paragraph";
  const isNumbered = layout === "numbered";
  const showStructureControls = !isParagraph || row.collapsed || isHovered || isSelected;

  const caretState = row.collapsed
    ? "collapsed"
    : row.showsSubsetOfChildren
      ? "partial"
      : "expanded";

  const caretLabel = caretState === "collapsed"
    ? "Expand node"
    : caretState === "partial"
      ? "Show all children"
      : "Collapse node";

  const caret = row.hasChildren ? (
    <button
      type="button"
      style={{
        ...rowStyles.toggleButton,
        opacity: showStructureControls ? 1 : 0,
        pointerEvents: showStructureControls ? "auto" : "none"
      }}
      onClick={handleToggleCollapsed}
      aria-label={caretLabel}
      data-outline-toggle="true"
    >
      <span
        style={{
          ...rowStyles.caretIconWrapper,
          ...(caretState === "collapsed"
            ? rowStyles.caretIconCollapsed
            : caretState === "partial"
              ? rowStyles.caretIconPartial
              : rowStyles.caretIconExpanded)
        }}
      >
        <svg viewBox="0 0 24 24" style={rowStyles.caretSvg} aria-hidden="true" focusable="false">
          <path d="M8 5l8 7-8 7z" />
        </svg>
      </span>
    </button>
  ) : (
    <span style={rowStyles.caretPlaceholder} data-outline-toggle-placeholder="true" />
  );

  const bulletVariant = row.hasChildren ? (row.collapsed ? "collapsed-parent" : "parent") : "leaf";
  const bulletCellStyle = isNumbered ? rowStyles.numberedBulletCell : rowStyles.bulletCell;
  const bulletLabel = isNumbered && row.listOrdinal !== null ? `${row.listOrdinal}.` : "•";
  const bulletGlyphStyle = isNumbered ? rowStyles.numberedBulletGlyph : rowStyles.bulletGlyph;
  const bulletBoxShadow = haloColor && showStructureControls ? `0 0 0 1px ${haloColor}` : "none";

  const bullet = (
    <button
      type="button"
      style={{
        ...rowStyles.bulletButton,
        ...(isNumbered ? rowStyles.numberedBulletButton : undefined),
        ...(bulletVariant === "collapsed-parent" ? rowStyles.collapsedBullet : rowStyles.standardBullet),
        boxShadow: bulletBoxShadow,
        opacity: showStructureControls ? 1 : 0,
        pointerEvents: showStructureControls ? "auto" : "none"
      }}
      data-outline-bullet={bulletVariant}
      data-outline-bullet-halo={bulletHaloVariant ?? undefined}
      data-outline-drag-handle="true"
      data-outline-list-ordinal={
        isNumbered && row.listOrdinal !== null ? String(row.listOrdinal) : undefined
      }
      onPointerDown={(event) => {
        onDragHandlePointerDown?.(event, row.edgeId);
      }}
      onMouseDown={handleBulletMouseDown}
      onClick={handleBulletClick}
      aria-label="Focus node"
    >
      <span style={bulletGlyphStyle}>{bulletLabel}</span>
    </button>
  );

  const todoToggleNode = row.metadata.todo
    ? (
      <div style={rowStyles.todoCell}>
        <button
          type="button"
          role="checkbox"
          aria-checked={isDone}
          aria-label={isDone ? "Mark task as incomplete" : "Mark task as complete"}
          style={{
            ...rowStyles.todoButton,
            ...(isDone ? rowStyles.todoButtonDone : undefined)
          }}
          data-outline-todo-toggle="true"
          data-outline-done={isDone ? "true" : undefined}
          disabled={!onToggleTodo}
          aria-disabled={onToggleTodo ? undefined : "true"}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleTodo?.(row.edgeId);
          }}
        >
          {isDone ? (
            <svg
              viewBox="0 0 20 20"
              style={rowStyles.todoButtonGlyph}
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M5 10.5l3 3 7-7"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </button>
      </div>
    )
    : null;

  const dropIndicatorNode = dropIndicator ? (
    <div
      style={{
        ...rowStyles.dropIndicator,
        left: `${dropIndicator.left}px`,
        width: `${dropIndicator.width}px`
      }}
      data-outline-drop-indicator={dropIndicator.type}
    />
  ) : null;

  const presenceIndicators = <PresenceIndicators participants={presence} />;

  const commonRowProps = {
    "data-outline-row": "true",
    "data-edge-id": row.edgeId,
    "data-outline-layout": layout,
    onPointerEnter: () => {
      if (isParagraph) {
        setIsHovered(true);
      }
    },
    onPointerLeave: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isParagraph && event.buttons === 0) {
        setIsHovered(false);
      }
    },
    onPointerDownCapture: (event: ReactPointerEvent<HTMLDivElement>) => {
      const tagElement = resolveTagElement(event.target);
      if (tagElement) {
        if (!(tagElement instanceof HTMLButtonElement)) {
          event.preventDefault();
        }
        return;
      }
      if (resolveDatePillElement(event.target)) {
        return;
      }
      if (isWikiLinkEvent(event.target)) {
        return;
      }
      onRowPointerDownCapture?.(event, row.edgeId);
    },
    onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => {
      const tagElement = resolveTagElement(event.target);
      if (tagElement) {
        if (!(tagElement instanceof HTMLButtonElement) && onTagClick) {
          const metadata = readTagMetadata(tagElement);
          if (metadata) {
            event.preventDefault();
            event.stopPropagation();
            onTagClick({
              edgeId: row.edgeId,
              sourceNodeId: row.nodeId,
              label: metadata.label,
              trigger: metadata.trigger
            });
          }
        }
        return;
      }
      if (resolveDatePillElement(event.target)) {
        return;
      }
      if (isWikiLinkEvent(event.target)) {
        return;
      }
      if (onRowMouseDown) {
        onRowMouseDown(event, row.edgeId);
        return;
      }
      onSelect(row.edgeId);
    },
    onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!onRowContextMenu) {
        return;
      }
      const buttonTarget = (event.target as HTMLElement | null)?.closest("button");
      if (buttonTarget) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onRowContextMenu(event, row.edgeId);
    }
  } as const;

  if (isSelected) {
    return (
      <div
        role="treeitem"
        aria-level={row.depth + 1}
        aria-selected={isSelected}
        style={{
          ...rowStyles.rowContainer,

          flex: "1 1 auto",
          backgroundColor: selectionBackground,
          borderLeft: selectionBorder
        }}
        {...commonRowProps}
      >
        <OutlineGuidelineLayer
          row={row}
          hoveredEdgeId={hoveredGuidelineEdgeId ?? null}
          onPointerEnter={onGuidelinePointerEnter}
          onPointerLeave={onGuidelinePointerLeave}
          onClick={onGuidelineClick}
          getLabel={getGuidelineLabel}
        />
        {dropIndicatorNode}
        <div
          style={{
            ...rowStyles.rowContentSelected,
            backgroundColor: selectionBackground
          }}
        >
          <div style={rowStyles.iconCell}>{caret}</div>
          <div style={bulletCellStyle}>{bullet}</div>
          {todoToggleNode}
          <div
            style={textCellStyle}
            ref={textCellRef}
            data-outline-text-cell="true"
            data-outline-done={isDone ? "true" : undefined}
          >
            {singletonBadgeNode}
            {textContentNode}
            {presenceIndicators}
          </div>
          {mirrorIndicatorNode}
        </div>
      </div>
    );
  }

  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={isSelected}
      style={{
        ...rowStyles.rowContainer,
        borderLeft: selectionBorder
      }}
      {...commonRowProps}
    >
      <OutlineGuidelineLayer
        row={row}
        hoveredEdgeId={hoveredGuidelineEdgeId ?? null}
        onPointerEnter={onGuidelinePointerEnter}
        onPointerLeave={onGuidelinePointerLeave}
        onClick={onGuidelineClick}
        getLabel={getGuidelineLabel}
      />
      {dropIndicatorNode}
      <div style={rowStyles.rowContentStatic}>
        <div style={rowStyles.iconCell}>{caret}</div>
        <div style={bulletCellStyle}>{bullet}</div>
        {todoToggleNode}
        <div
          style={textCellStyle}
          ref={textCellRef}
          data-outline-text-cell="true"
          data-outline-done={isDone ? "true" : undefined}
        >
          {singletonBadgeNode}
          {textContentNode}
          {presenceIndicators}
        </div>
        {mirrorIndicatorNode}
      </div>
    </div>
  );
};

const rowStyles: Record<string, CSSProperties> = {
  rowContainer: {
    display: "flex",
    alignItems: "stretch",
    flex: "1 1 auto",
    minWidth: 0,
    position: "relative"
  },
  dropIndicator: {
    position: "absolute",
    height: "2px",
    backgroundColor: "#9ca3af",
    bottom: "-1px",
    pointerEvents: "none",
    zIndex: 3
  },
  guidelineContainer: {
    display: "flex",
    alignItems: "stretch",
    flexShrink: 0,
    height: "auto",
    alignSelf: "stretch"
  },
  guidelinePair: {
    display: "flex",
    alignItems: "stretch",
    flexShrink: 0
  },
  guidelineSpacer: {
    width: `${OUTLINE_ROW_GUIDELINE_SPACER_REM}rem`,
    pointerEvents: "none",
    flexShrink: 0,
    height: "100%",
    margin: "0 2px"
  },
  guidelineButton: {
    display: "flex",
    alignItems: "stretch",
    justifyContent: "center",
    width: `${OUTLINE_ROW_GUIDELINE_COLUMN_REM}rem`,
    padding: 0,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    height: "100%"
  },
  guidelinePlaceholder: {
    display: "flex",
    width: `${OUTLINE_ROW_GUIDELINE_COLUMN_REM}rem`,
    pointerEvents: "none",
    flexShrink: 0,
    height: "100%"
  },
  guidelineLine: {
    width: "2px",
    height: "100%",
    backgroundColor: "#f0f2f4ff",
    transition: "width 120ms ease, background-color 120ms ease",
    margin: "0 auto"
  },
  guidelineLineHovered: {
    width: "4px",
    backgroundColor: "#99999dff"
  },
  rowContentSelected: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.25rem",
    width: "100%"
  },
  rowContentStatic: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.25rem",
    width: "100%"
  },
  tagPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    padding: "0.05rem 0.45rem",
    borderRadius: "9999px",
    backgroundColor: "#eef2ff",
    color: "#312e81",
    fontSize: "0.85rem",
    fontWeight: 600,
    lineHeight: 1.2,
    marginRight: "0.25rem"
  },
  tagButton: {
    display: "inline-flex",
    alignItems: "stretch",
    margin: 0,
    border: "none",
    background: "transparent",
    padding: "0",
    cursor: "pointer",
    boxSizing: "content-box",
    font: "inherit",
    lineHeight: "inherit"
  },
  tagPillMention: {
    backgroundColor: "#fef3c7",
    color: "#92400e"
  },
  iconCell: {
    width: `${OUTLINE_ROW_TOGGLE_DIAMETER_REM}rem`,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center"
  },
  bulletCell: {
    width: `${OUTLINE_ROW_BULLET_DIAMETER_REM}rem`,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center"
  },
  todoCell: {
    width: `${OUTLINE_ROW_TOGGLE_DIAMETER_REM}rem`,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    flexShrink: 0
  },
  numberedBulletCell: {
    width: "2.4rem",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-end"
  },
  bulletButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${OUTLINE_ROW_BULLET_DIAMETER_REM}rem`,
    height: `${OUTLINE_ROW_BULLET_DIAMETER_REM}rem`,
    border: "none",
    background: "transparent",
    borderRadius: "9999px",
    cursor: "pointer",
    marginTop: `${OUTLINE_ROW_CONTROL_VERTICAL_OFFSET_REM}rem`
  },
  todoButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${OUTLINE_ROW_TOGGLE_DIAMETER_REM}rem`,
    height: `${OUTLINE_ROW_TOGGLE_DIAMETER_REM}rem`,
    borderRadius: "9999px",
    border: "2px solid #d1d5db",
    backgroundColor: "#ffffff",
    color: "#1f2937",
    cursor: "pointer",
    padding: 0,
    boxSizing: "border-box",
    marginTop: `${OUTLINE_ROW_CONTROL_VERTICAL_OFFSET_REM}rem`,
    transition: "background-color 120ms ease, border-color 120ms ease, color 120ms ease"
  },
  todoButtonDone: {
    backgroundColor: "#4ade80",
    borderColor: "#22c55e",
    color: "#14532d"
  },
  todoButtonGlyph: {
    width: "0.65rem",
    height: "0.65rem"
  },
  numberedBulletButton: {
    width: "100%",
    justifyContent: "flex-end",
    paddingRight: "0.25rem",
    paddingLeft: "0.25rem",
    borderRadius: "0.75rem"
  },
  standardBullet: {
    backgroundColor: "transparent"
  },
  collapsedBullet: {
    backgroundColor: "#e5e7eb",
    borderRadius: "9999px"
  },
  bulletGlyph: {
    color: "#77797d",
    fontSize: "1.7rem",
    lineHeight: 1
  },
  numberedBulletGlyph: {
    color: "#4b5563",
    fontSize: "0.95rem",
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600
  },
  caretPlaceholder: {
    display: "inline-flex",
    width: `${OUTLINE_ROW_TOGGLE_DIAMETER_REM}rem`,
    height: `${OUTLINE_ROW_TOGGLE_DIAMETER_REM}rem`,
    marginTop: `${OUTLINE_ROW_CONTROL_VERTICAL_OFFSET_REM}rem`
  },
  toggleButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${OUTLINE_ROW_TOGGLE_DIAMETER_REM}rem`,
    height: `${OUTLINE_ROW_TOGGLE_DIAMETER_REM}rem`,
    border: "none",
    background: "transparent",
    color: "#6b7280",
    cursor: "pointer",
    padding: 0,
    marginTop: `${OUTLINE_ROW_CONTROL_VERTICAL_OFFSET_REM}rem`
  },
  caretIconWrapper: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "0.9rem",
    height: "0.9rem",
    transition: "transform 120ms ease"
  },
  caretIconCollapsed: {
    transform: "rotate(0deg)"
  },
  caretIconExpanded: {
    transform: "rotate(90deg)"
  },
  caretIconPartial: {
    transform: "rotate(45deg)"
  },
  caretSvg: {
    display: "inline",
    width: "100%",
    height: "100%",
    fill: "#6b7280"
  },
  textCell: {
    flex: "1 1 auto",
    minWidth: 0,
    display: "flex",
    alignItems: "flex-start",
    gap: "0.5rem",
    cursor: "text",
    padding: `0 0 ${OUTLINE_ROW_BOTTOM_PADDING_REM}rem`,
    lineHeight: `${OUTLINE_ROW_LINE_HEIGHT_REM}rem`
  },
  textCellDone: {
    opacity: 0.5,
    textDecoration: "line-through"
  },
  rowText: {
    display: "inline",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    lineHeight: "inherit"
  },
  rowTextDone: {
    textDecoration: "inherit"
  },
  rowTextPlaceholder: {
    color: "#9ca3af",
    fontStyle: "italic"
  },
  datePill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    padding: "0.05rem 0.45rem",
    borderRadius: "9999px",
    backgroundColor: "#f3f4f6",
    color: "#374151",
    fontSize: "0.85rem",
    fontWeight: 400,
    lineHeight: 1.2,
    marginRight: "0.25rem",
    cursor: "pointer"
  },
  dateButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    padding: "0.05rem 0.45rem",
    borderRadius: "9999px",
    backgroundColor: "#f3f4f6",
    color: "#374151",
    fontSize: "0.85rem",
    fontWeight: 400,
    lineHeight: 1.2,
    marginRight: "0.25rem",
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    outline: "none",
    appearance: "none",
    boxShadow: "none",
    textDecoration: "none"
  },
  wikiLink: {
    background: "transparent",
    border: "none",
    padding: 0,
    margin: 0,
    font: "inherit",
    color: "inherit",
    textDecoration: "underline",
    cursor: "pointer",
    display: "inline"
  },
  rightRailCell: {
    flex: "0 0 auto",
    minWidth: "2.25rem",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-end",
    paddingTop: `${OUTLINE_ROW_CONTROL_VERTICAL_OFFSET_REM}rem`
  },
  mirrorBadgeButton: {
    width: "0.75rem",
    height: "0.75rem",
    borderRadius: "50%",
    backgroundColor: "transparent",
    border: "2px solid transparent",
    boxSizing: "border-box",
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.45rem",
    fontWeight: 600,
    color: "inherit",
    cursor: "pointer",
    boxShadow: "0 8px 20px rgba(15, 23, 42, 0.15)",
    transition: "transform 120ms ease, box-shadow 120ms ease"
  },
  mirrorBadgeText: {
    lineHeight: 1
  },
  mirrorBadgeActive: {
    boxShadow: "0 0 0 2px rgba(255, 255, 255, 0.88), 0 12px 30px rgba(37, 99, 235, 0.22)",
    transform: "scale(1.05)"
  },
  singletonBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1.05rem",
    height: "1.05rem",
    borderRadius: "0.4rem",
    marginTop: "0.1rem",
    flexShrink: 0,
    boxSizing: "border-box",
    pointerEvents: "none"
  },
  singletonBadgeInbox: {
    backgroundColor: "#e0f2fe",
    border: "1px solid #bae6fd",
    color: "#0369a1"
  },
  singletonBadgeJournal: {
    backgroundColor: "#ede9fe",
    border: "1px solid #ddd6fe",
    color: "#5b21b6"
  },
  singletonBadgeGlyph: {
    width: "0.7rem",
    height: "0.7rem"
  }
};
