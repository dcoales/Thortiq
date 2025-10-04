/**
 * Pure presentational header for an outline pane showing focus breadcrumbs and navigation
 * controls. Encapsulates measurement logic so the container only supplies focus metadata and
 * callbacks, keeping responsibilities separated per AGENTS.md guidance.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";

import type { EdgeId } from "@thortiq/client-core";
import {
  planBreadcrumbVisibility,
  type BreadcrumbDisplayPlan,
  type BreadcrumbMeasurement,
  type PaneFocusContext
} from "@thortiq/client-core";
import type { FocusHistoryDirection, FocusPanePayload } from "@thortiq/sync-core";

interface OutlineHeaderProps {
  readonly focus: PaneFocusContext | null;
  readonly canNavigateBack: boolean;
  readonly canNavigateForward: boolean;
  readonly onNavigateHistory: (direction: FocusHistoryDirection) => void;
  readonly onFocusEdge: (payload: FocusPanePayload) => void;
  readonly onClearFocus: () => void;
}

interface BreadcrumbDescriptor {
  readonly key: string;
  readonly label: string;
  readonly edgeId: EdgeId | null;
  readonly pathEdgeIds: ReadonlyArray<EdgeId>;
  readonly isCurrent: boolean;
  readonly icon?: "home";
}

export const OutlineHeader = ({
  focus,
  canNavigateBack,
  canNavigateForward,
  onNavigateHistory,
  onFocusEdge,
  onClearFocus
}: OutlineHeaderProps): JSX.Element | null => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measurementRefs = useRef(new Map<number, HTMLSpanElement>());
  const ellipsisMeasurementRef = useRef<HTMLSpanElement | null>(null);
  const listWrapperRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [plan, setPlan] = useState<BreadcrumbDisplayPlan | null>(null);
  const [openDropdown, setOpenDropdown] = useState<
    | { readonly items: ReadonlyArray<BreadcrumbDescriptor>; readonly left: number; readonly top: number }
    | null
  >(null);

  const crumbs = useMemo<ReadonlyArray<BreadcrumbDescriptor>>(() => {
    if (!focus) {
      return [
        {
          key: "document",
          label: "Home",
          edgeId: null,
          pathEdgeIds: [],
          isCurrent: true,
          icon: "home"
        }
      ];
    }

    const entries: BreadcrumbDescriptor[] = [
      {
        key: "document",
        label: "Home",
        edgeId: null,
        pathEdgeIds: [],
        isCurrent: focus.path.length === 0,
        icon: "home"
      }
    ];

    focus.path.forEach((segment, index) => {
      const accumulated = focus.path.slice(0, index + 1).map((entry) => entry.edge.id);
      entries.push({
        key: segment.edge.id,
        label: segment.node.text ?? "",
        edgeId: segment.edge.id,
        pathEdgeIds: accumulated,
        isCurrent: index === focus.path.length - 1
      });
    });

    return entries;
  }, [focus]);

  const setMeasurementRef = useCallback((index: number) => (element: HTMLSpanElement | null) => {
    const map = measurementRefs.current;
    if (!element) {
      map.delete(index);
      return;
    }
    map.set(index, element);
  }, []);

  const renderBreadcrumbContent = (crumb: BreadcrumbDescriptor): ReactNode => {
    if (crumb.icon === "home") {
      return (
        <span style={headerStyles.breadcrumbIcon} aria-hidden="true">
          <svg
            focusable="false"
            viewBox="0 0 24 24"
            style={headerStyles.breadcrumbIconGlyph}
            aria-hidden="true"
          >
            <path
              d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4h-4v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
          </svg>
        </span>
      );
    }
    if (crumb.label.trim().length === 0) {
      return (
        <span style={headerStyles.breadcrumbEmptyLabel} aria-hidden>
          &nbsp;
        </span>
      );
    }
    return crumb.label;
  };

  useLayoutEffect(() => {
    const target = listWrapperRef.current ?? containerRef.current;
    if (!target) {
      return;
    }

    const measure = () => {
      const rect = target.getBoundingClientRect();
      if (rect.width > 0) {
        setContainerWidth(rect.width);
        return;
      }
      const fallbackRect = target.parentElement?.getBoundingClientRect();
      setContainerWidth(fallbackRect?.width ?? rect.width);
    };

    if (typeof ResizeObserver !== "function") {
      measure();
      return () => undefined;
    }

    const observer = new ResizeObserver(() => measure());
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const measurements: BreadcrumbMeasurement[] = crumbs.map((_, index) => {
      const element = measurementRefs.current.get(index);
      const width = element ? element.getBoundingClientRect().width : 0;
      return { width };
    });
    if (measurements.length === 0) {
      setPlan(null);
      return;
    }
    const ellipsisWidth = ellipsisMeasurementRef.current?.getBoundingClientRect().width ?? 0;
    setPlan(planBreadcrumbVisibility(measurements, containerWidth, ellipsisWidth));
  }, [containerWidth, crumbs]);

  useEffect(() => {
    if (plan) {
      setOpenDropdown(null);
    }
  }, [plan]);

  const collapsedRanges = plan?.collapsedRanges ?? [];

  const allowLastCrumbTruncation = (() => {
    if (!plan || plan.collapsedRanges.length === 0) {
      return false;
    }
    const lastIndex = crumbs.length - 1;
    if (lastIndex <= 0) {
      return false;
    }
    if (plan.fitsWithinWidth) {
      return false;
    }
    if (collapsedRanges.length !== 1) {
      return false;
    }
    const [start, end] = collapsedRanges[0];
    return start === 0 && end === lastIndex - 1;
  })();

  const handleCrumbSelect = (crumb: BreadcrumbDescriptor) => {
    if (crumb.edgeId === null) {
      onClearFocus();
      return;
    }
    onFocusEdge({ edgeId: crumb.edgeId, pathEdgeIds: crumb.pathEdgeIds });
  };

  const handleEllipsisClick = (
    event: MouseEvent<HTMLButtonElement>,
    range: readonly [number, number]
  ) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    const anchorRect = event.currentTarget.getBoundingClientRect();
    if (!containerRect) {
      return;
    }
    const items = crumbs.slice(range[0], range[1] + 1);
    setOpenDropdown({
      items,
      left: anchorRect.left - containerRect.left,
      top: anchorRect.bottom - containerRect.top + 8
    });
  };

  const renderCrumbs = () => {
    const nodes: ReactNode[] = [];
    let rangeIndex = 0;
    for (let index = 0; index < crumbs.length;) {
      const range = collapsedRanges[rangeIndex];
      if (range && index === range[0]) {
        const ellipsisKey = `ellipsis-${range[0]}-${range[1]}`;
        if (nodes.length > 0) {
          nodes.push(
            <span key={`${ellipsisKey}-sep`} style={headerStyles.breadcrumbSeparator} aria-hidden>
              ›
            </span>
          );
        }
        nodes.push(
          <button
            key={ellipsisKey}
            type="button"
            style={headerStyles.breadcrumbEllipsis}
            onClick={(event) => handleEllipsisClick(event, range)}
            aria-label="Show hidden ancestors"
          >
            …
          </button>
        );
        index = range[1] + 1;
        rangeIndex += 1;
        continue;
      }

      const crumb = crumbs[index];
      const key = `crumb-${crumb.key}`;
      const isHome = crumb.icon === "home";
      if (nodes.length > 0) {
        nodes.push(
          <span key={`${key}-sep`} style={headerStyles.breadcrumbSeparator} aria-hidden>
            ›
          </span>
        );
      }
      const content = renderBreadcrumbContent(crumb);
      if (crumb.isCurrent) {
        const crumbStyle = allowLastCrumbTruncation && index === crumbs.length - 1
          ? { ...headerStyles.breadcrumbCurrent, ...headerStyles.breadcrumbTruncatedCurrent }
          : headerStyles.breadcrumbCurrent;
        const adjustedCrumbStyle = isHome
          ? { ...crumbStyle, paddingLeft: 0 }
          : crumbStyle;
        nodes.push(
          <span
            key={key}
            style={adjustedCrumbStyle}
            aria-current="page"
            aria-label={crumb.icon === "home" ? crumb.label : undefined}
          >
            {content}
          </span>
        );
      } else {
        nodes.push(
          <button
            key={key}
            type="button"
            style={isHome ? headerStyles.breadcrumbHomeButton : headerStyles.breadcrumbButton}
            onClick={() => handleCrumbSelect(crumb)}
            aria-label={crumb.icon === "home" ? crumb.label : undefined}
          >
            {content}
          </button>
        );
      }
      index += 1;
    }
    return nodes;
  };

  return (
    <header style={headerStyles.focusHeader}>
      <div ref={containerRef} style={headerStyles.breadcrumbBar}>
        <div style={headerStyles.breadcrumbMeasurements} aria-hidden>
          {crumbs.map((crumb, index) => (
            <span
              key={`measure-${crumb.key}`}
              ref={setMeasurementRef(index)}
              style={crumb.icon === "home" ? headerStyles.breadcrumbMeasureHomeItem : headerStyles.breadcrumbMeasureItem}
            >
              {renderBreadcrumbContent(crumb)}
            </span>
          ))}
          <span ref={ellipsisMeasurementRef} style={headerStyles.breadcrumbMeasureItem}>
            …
          </span>
        </div>
        <div style={headerStyles.breadcrumbRow}>
          <nav aria-label="Focused node breadcrumbs" style={headerStyles.breadcrumbListWrapper}>
            <div ref={listWrapperRef} style={headerStyles.breadcrumbListViewport}>
              <div style={headerStyles.breadcrumbList}>{renderCrumbs()}</div>
            </div>
          </nav>
          <div style={headerStyles.historyControls}>
            <button
              type="button"
              style={{
                ...headerStyles.historyButton,
                color: canNavigateBack ? "#aaabad" : "#d4d4d8",
                cursor: canNavigateBack ? "pointer" : "default"
              }}
              onClick={() => onNavigateHistory("back")}
              disabled={!canNavigateBack}
              aria-label="Go back to the previous focused node"
              title="Back"
            >
              <span aria-hidden>{"<"}</span>
            </button>
            <button
              type="button"
              style={{
                ...headerStyles.historyButton,
                color: canNavigateForward ? "#aaabad" : "#d4d4d8",
                cursor: canNavigateForward ? "pointer" : "default"
              }}
              onClick={() => onNavigateHistory("forward")}
              disabled={!canNavigateForward}
              aria-label="Go forward to the next focused node"
              title="Forward"
            >
              <span aria-hidden>{">"}</span>
            </button>
          </div>
        </div>
        {openDropdown ? (
          <div
            style={{
              ...headerStyles.breadcrumbDropdown,
              left: `${openDropdown.left}px`,
              top: `${openDropdown.top}px`
            }}
          >
            {openDropdown.items.map((crumb) => (
              <button
                key={`dropdown-${crumb.key}`}
                type="button"
                style={headerStyles.breadcrumbDropdownButton}
                onClick={() => {
                  handleCrumbSelect(crumb);
                  setOpenDropdown(null);
                }}
              >
                {renderBreadcrumbContent(crumb)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <h2 style={headerStyles.focusTitle}>{focus ? focus.node.text ?? "" : ""}</h2>
    </header>
  );
};

const headerStyles: Record<string, CSSProperties> = {
  focusHeader: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    padding: "0.75rem 0.75rem 0.5rem 0"
  },
  breadcrumbBar: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem"
  },
  breadcrumbMeasurements: {
    position: "absolute",
    inset: 0,
    visibility: "hidden",
    pointerEvents: "none",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem"
  },
  breadcrumbMeasureItem: {
    display: "inline-flex",
    alignItems: "center",
    fontFamily: "inherit",
    fontSize: "0.875rem",
    fontWeight: 500
  },
  breadcrumbMeasureHomeItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    fontFamily: "inherit",
    fontSize: "0.875rem",
    fontWeight: 500
  },
  breadcrumbRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem"
  },
  breadcrumbListWrapper: {
    flex: 1,
    minWidth: 0
  },
  breadcrumbListViewport: {
    overflow: "hidden"
  },
  breadcrumbList: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontFamily: "inherit",
    fontSize: "0.875rem",
    fontWeight: 400,
    color: "#aaabad"
  },
  breadcrumbSeparator: {
    color: "#aaabad"
  },
  breadcrumbEllipsis: {
    border: "none",
    background: "none",
    padding: 0,
    fontSize: "1rem",
    cursor: "pointer",
    color: "#aaabad"
  },
  breadcrumbButton: {
    border: "none",
    background: "none",
    color: "#aaabad",
    font: "inherit",
    padding: 0,
    cursor: "pointer",
    whiteSpace: "nowrap"
  },
  breadcrumbHomeButton: {
    border: "none",
    background: "none",
    color: "#aaabad",
    font: "inherit",
    padding: 0,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem"
  },
  breadcrumbCurrent: {
    color: "#aaabad",
    fontWeight: 400,
    whiteSpace: "nowrap"
  },
  breadcrumbTruncatedCurrent: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "14rem"
  },
  breadcrumbIcon: {
    display: "inline-flex",
    width: "1rem",
    height: "1rem",
    paddingBottom: "3px",
    color: "#aaabad"
  },
  breadcrumbIconGlyph: {
    width: "100%",
    height: "100%"
  },
  breadcrumbEmptyLabel: {
    display: "inline-block",
    minWidth: "0.75rem"
  },
  historyControls: {
    display: "flex",
    alignItems: "center",
    gap: "0.25rem"
  },
  historyButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1rem",
    height: "1.75rem",
    border: "none",
    background: "none"
  },
  breadcrumbDropdown: {
    position: "absolute",
    minWidth: "10rem",
    zIndex: 10,
    backgroundColor: "#ffffff",
    borderRadius: "0.5rem",
    boxShadow: "0 10px 30px -10px rgba(15, 23, 42, 0.25)",
    padding: "0.5rem"
  },
  breadcrumbDropdownButton: {
    border: "none",
    background: "none",
    padding: "0.25rem 0.5rem",
    borderRadius: "0.375rem",
    textAlign: "left",
    width: "100%",
    cursor: "pointer",
    font: "inherit",
    color: "#aaabad"
  },
  focusTitle: {
    margin: 0,
    fontFamily: "inherit",
    fontSize: "1.25rem",
    fontWeight: 600,
    color: "#111827"
  }
};
