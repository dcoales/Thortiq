/**
 * Presentational outline row renderer that maps shared row state into DOM-ready markup.
 * Handles focus, collapse toggles, drag handles, and presence display without mutating state.
 */
import { useLayoutEffect, useRef } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";

import type { EdgeId, InlineSpan, NodeId } from "@thortiq/client-core";
import type { OutlinePresenceParticipant } from "@thortiq/client-core";
import type { FocusPanePayload } from "@thortiq/sync-core";

import type { OutlineRow } from "../useOutlineRows";
import type { DropIndicatorDescriptor } from "../useOutlineDragAndDrop";
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
  readonly onWikiLinkClick?: OutlineRowViewProps["onWikiLinkClick"];
  readonly onWikiLinkHover?: OutlineRowViewProps["onWikiLinkHover"];
}

const OutlineInlineContent = ({
  spans,
  edgeId,
  sourceNodeId,
  onWikiLinkClick,
  onWikiLinkHover
}: OutlineInlineContentProps): JSX.Element => {
  return (
    <>
      {spans.map((span, index) => {
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
        return (
          <span key={`inline-${index}`}>{span.text}</span>
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
  readonly presence: readonly OutlinePresenceParticipant[];
  readonly dropIndicator?: DropIndicatorDescriptor | null;
  readonly hoveredGuidelineEdgeId?: EdgeId | null;
  readonly onSelect: (edgeId: EdgeId) => void;
  readonly onFocusEdge?: (payload: FocusPanePayload) => void;
  readonly onToggleCollapsed: (edgeId: EdgeId, collapsed?: boolean) => void;
  readonly onRowMouseDown?: (event: ReactMouseEvent<HTMLDivElement>, edgeId: EdgeId) => void;
  readonly onRowPointerDownCapture?: (
    event: ReactPointerEvent<HTMLDivElement>,
    edgeId: EdgeId
  ) => void;
  readonly onDragHandlePointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    edgeId: EdgeId
  ) => void;
  readonly onActiveTextCellChange?: (edgeId: EdgeId, element: HTMLDivElement | null) => void;
  readonly onGuidelinePointerEnter?: (edgeId: EdgeId) => void;
  readonly onGuidelinePointerLeave?: (edgeId: EdgeId) => void;
  readonly onGuidelineClick?: (edgeId: EdgeId) => void;
  readonly getGuidelineLabel?: (edgeId: EdgeId) => string;
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
  readonly onMirrorIndicatorClick?: (payload: OutlineMirrorIndicatorClickPayload) => void;
  readonly activeMirrorIndicatorEdgeId?: EdgeId | null;
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
  onRowMouseDown,
  onRowPointerDownCapture,
  onDragHandlePointerDown,
  onActiveTextCellChange,
  editorEnabled,
  presence,
  dropIndicator,
  hoveredGuidelineEdgeId,
  onGuidelinePointerEnter,
  onGuidelinePointerLeave,
  onGuidelineClick,
  getGuidelineLabel,
  onWikiLinkClick,
  onWikiLinkHover,
  onMirrorIndicatorClick,
  activeMirrorIndicatorEdgeId
}: OutlineRowViewProps): JSX.Element => {
  const textCellRef = useRef<HTMLDivElement | null>(null);
  const isDone = row.metadata.todo?.done ?? false;
  const rawText = row.text ?? "";
  const trimmedText = rawText.trim();
  const nodeLabel = trimmedText.length > 0 ? trimmedText : null;
  const isPlaceholder = trimmedText.length === 0;

  const shouldHideStaticText = editorEnabled && editorAttachedEdgeId === row.edgeId;

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
        onWikiLinkClick={onWikiLinkClick}
        onWikiLinkHover={onWikiLinkHover}
      />
    );
  };
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
  const textSpanStyle = isPlaceholder
    ? { ...baseTextSpanStyle, ...rowStyles.rowTextPlaceholder }
    : baseTextSpanStyle;

  const textContentNode = (
    <span
      style={{
        ...textSpanStyle,
        display: shouldHideStaticText ? "none" : "inline"
      }}
      data-outline-text-content="true"
      data-outline-text-placeholder={isPlaceholder ? "true" : undefined}
    >
      {renderInlineContent()}
    </span>
  );

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
    if (!onFocusEdge) {
      return;
    }
    const pathEdgeIds = [...row.ancestorEdgeIds, row.edgeId];
    onFocusEdge({ edgeId: row.edgeId, pathEdgeIds });
  };

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
      style={rowStyles.toggleButton}
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

  const bullet = (
    <button
      type="button"
      style={{
        ...rowStyles.bulletButton,
        ...(bulletVariant === "collapsed-parent" ? rowStyles.collapsedBullet : rowStyles.standardBullet),
        boxShadow: haloColor ? `0 0 0 1px ${haloColor}` : "none"
      }}
      data-outline-bullet={bulletVariant}
      data-outline-bullet-halo={bulletHaloVariant ?? undefined}
      data-outline-drag-handle="true"
      onPointerDown={(event) => {
        onDragHandlePointerDown?.(event, row.edgeId);
      }}
      onMouseDown={handleBulletMouseDown}
      onClick={handleBulletClick}
      aria-label="Focus node"
    >
      <span style={rowStyles.bulletGlyph}>•</span>
    </button>
  );

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
    onPointerDownCapture: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isWikiLinkEvent(event.target)) {
        return;
      }
      onRowPointerDownCapture?.(event, row.edgeId);
    },
    onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isWikiLinkEvent(event.target)) {
        return;
      }
      if (onRowMouseDown) {
        onRowMouseDown(event, row.edgeId);
        return;
      }
      onSelect(row.edgeId);
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
          <div style={rowStyles.bulletCell}>{bullet}</div>
          <div
            style={textCellStyle}
            ref={textCellRef}
            data-outline-text-cell="true"
            data-outline-done={isDone ? "true" : undefined}
          >
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
        <div style={rowStyles.bulletCell}>{bullet}</div>
        <div
          style={textCellStyle}
          ref={textCellRef}
          data-outline-text-cell="true"
          data-outline-done={isDone ? "true" : undefined}
        >
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
  }
};
