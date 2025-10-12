/**
 * Pure presentational header for an outline pane showing focus breadcrumbs, navigation controls,
 * and the pane-scoped search affordances. Encapsulates measurement logic so the container only
 * supplies focus metadata, callbacks, and search controller hooks, keeping responsibilities
 * separated per AGENTS.md guidance.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  ChangeEvent
} from "react";

import type { EdgeId } from "@thortiq/client-core";
import {
  planBreadcrumbVisibility,
  type BreadcrumbDisplayPlan,
  type BreadcrumbMeasurement,
  type PaneFocusContext
} from "@thortiq/client-core";
import type { PaneSearchController } from "@thortiq/client-react";
import type { FocusHistoryDirection, FocusPanePayload } from "@thortiq/sync-core";

const AUTO_SUBMIT_DELAY_MS = 1000;

interface HandleClearFocusOptions {
  readonly preserveSearch?: boolean;
}

interface OutlineHeaderProps {
  readonly focus: PaneFocusContext | null;
  readonly canNavigateBack: boolean;
  readonly canNavigateForward: boolean;
  readonly onNavigateHistory: (direction: FocusHistoryDirection) => void;
  readonly onFocusEdge: (payload: FocusPanePayload) => void;
  readonly onClearFocus: (options?: HandleClearFocusOptions) => void;
  readonly search: PaneSearchController;
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
  onClearFocus,
  search
}: OutlineHeaderProps): JSX.Element | null => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measurementRefs = useRef(new Map<number, HTMLSpanElement>());
  const ellipsisMeasurementRef = useRef<HTMLSpanElement | null>(null);
  const listWrapperRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const lastAutoSubmitAttemptRef = useRef<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [plan, setPlan] = useState<BreadcrumbDisplayPlan | null>(null);
  const [openDropdown, setOpenDropdown] = useState<
    | { readonly items: ReadonlyArray<BreadcrumbDescriptor>; readonly left: number; readonly top: number }
    | null
  >(null);
  const [parseError, setParseError] = useState<string | null>(null);

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

  useEffect(() => {
    if (search.isInputVisible) {
      setOpenDropdown(null);
      const timer = setTimeout(() => {
        const element = searchInputRef.current;
        if (!element) {
          return;
        }
        element.focus();
        const end = element.value.length;
        element.setSelectionRange(end, end);
      }, 0);
      return () => clearTimeout(timer);
    }
    setParseError(null);
    return () => undefined;
  }, [search.isInputVisible]);

  useEffect(() => {
    if (parseError && search.draft.trim().length === 0) {
      setParseError(null);
    }
  }, [parseError, search.draft]);

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

  const handleSearchIconClick = useCallback(() => {
    if (search.isInputVisible) {
      search.clearResults();
      search.hideInput();
      setParseError(null);
      return;
    }
    search.setInputVisible(true);
    setParseError(null);
  }, [search]);

  const applySearch = useCallback(() => {
    const result = search.submit();
    const trimmedDraft = search.draft.trim();
    lastAutoSubmitAttemptRef.current = trimmedDraft;
    if (!result.ok) {
      setParseError(result.error.message);
      const element = searchInputRef.current;
      if (element) {
        const start = Number.isFinite(result.error.start) ? result.error.start : element.selectionStart ?? 0;
        const end = Number.isFinite(result.error.end) ? result.error.end ?? start : start;
        try {
          element.setSelectionRange(start, end);
        } catch {
          // Some browsers throw for invalid ranges; ignore and continue.
        }
      }
      return;
    }
    setParseError(null);
  }, [search]);

  const handleSearchSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      applySearch();
    },
    [applySearch]
  );

  const handleSearchInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (parseError) {
        setParseError(null);
      }
      search.setDraft(event.target.value);
      lastAutoSubmitAttemptRef.current = null;
    },
    [parseError, search]
  );

  const handleSearchInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        search.clearResults();
        search.hideInput();
        setParseError(null);
      }
    },
    [search]
  );

  const handleSearchClearClick = useCallback(() => {
    const hasDraft = search.draft.trim().length > 0;
    const hasSubmitted = Boolean(search.submitted && search.submitted.length > 0);
    const hasResults = search.resultEdgeIds.length > 0;
    if (hasDraft || hasSubmitted || hasResults) {
      search.clearResults();
      setParseError(null);
      return;
    }
    search.clearResults();
    search.hideInput();
    setParseError(null);
  }, [search]);

  useEffect(() => {
    if (!search.isInputVisible) {
      lastAutoSubmitAttemptRef.current = null;
      return;
    }
    // Run pane search after a short pause to avoid submitting on every keystroke.
    const trimmedDraft = search.draft.trim();
    const trimmedSubmitted = (search.submitted ?? "").trim();
    if (trimmedDraft.length === 0 && trimmedSubmitted.length === 0 && search.resultEdgeIds.length === 0) {
      lastAutoSubmitAttemptRef.current = null;
      return;
    }
    if (trimmedDraft === trimmedSubmitted) {
      lastAutoSubmitAttemptRef.current = trimmedDraft;
      return;
    }
    if (lastAutoSubmitAttemptRef.current === trimmedDraft) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    const timer = window.setTimeout(() => {
      applySearch();
    }, AUTO_SUBMIT_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [applySearch, search.draft, search.isInputVisible, search.resultEdgeIds.length, search.submitted]);

  const handleSearchHomeClick = useCallback(() => {
    if (!search.isInputVisible) {
      search.setInputVisible(true);
    }
    setParseError(null);
    onClearFocus({ preserveSearch: true });
  }, [onClearFocus, search]);

  const renderSearchHomeCrumb = () => {
    const homeCrumb = crumbs[0];
    if (!homeCrumb) {
      return null;
    }
    const content = renderBreadcrumbContent(homeCrumb);
    return (
      <button
        key="search-home"
        type="button"
        style={
          homeCrumb.isCurrent
            ? { ...headerStyles.breadcrumbHomeButton, ...headerStyles.breadcrumbHomeCurrent }
            : headerStyles.breadcrumbHomeButton
        }
        onClick={handleSearchHomeClick}
        aria-current={homeCrumb.isCurrent ? "page" : undefined}
        aria-label={homeCrumb.icon === "home" ? homeCrumb.label : undefined}
      >
        {content}
      </button>
    );
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
          ? { ...crumbStyle, ...headerStyles.breadcrumbHomeCurrent }
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

  const searchFormStyle = parseError
    ? { ...headerStyles.searchForm, borderColor: "#f87171" }
    : headerStyles.searchForm;

  const searchErrorNode = parseError && search.isInputVisible
    ? (
        <p style={headerStyles.searchFeedback} role="alert">
          {parseError}
        </p>
      )
    : null;

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
          <div style={headerStyles.primarySection}>
            <nav aria-label="Focused node breadcrumbs" style={headerStyles.breadcrumbListWrapper}>
              {search.isInputVisible ? (
                <div style={headerStyles.searchBar}>
                  {renderSearchHomeCrumb()}
                  <form style={searchFormStyle} onSubmit={handleSearchSubmit}>
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={search.draft}
                      onChange={handleSearchInputChange}
                      onKeyDown={handleSearchInputKeyDown}
                      placeholder="Search…"
                      aria-label="Search outline"
                      aria-invalid={parseError ? true : false}
                      style={headerStyles.searchInput}
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      style={headerStyles.searchClearButton}
                      onClick={handleSearchClearClick}
                      aria-label="Clear search"
                      title="Clear search"
                    >
                      ×
                    </button>
                  </form>
                </div>
              ) : (
                <div ref={listWrapperRef} style={headerStyles.breadcrumbListViewport}>
                  <div style={headerStyles.breadcrumbList}>{renderCrumbs()}</div>
                </div>
              )}
            </nav>
          </div>
          <div style={headerStyles.headerActions}>
            <button
              type="button"
              style={{
                ...headerStyles.searchToggleButton,
                ...(search.isInputVisible ? headerStyles.searchToggleButtonActive : undefined)
              }}
              onClick={handleSearchIconClick}
              aria-label={search.isInputVisible ? "Close search" : "Search outline"}
              title={search.isInputVisible ? "Close search" : "Search"}
            >
              <svg
                focusable="false"
                viewBox="0 0 24 24"
                style={headerStyles.searchIconGlyph}
                aria-hidden="true"
              >
                <circle
                  cx="11"
                  cy="11"
                  r="6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <line
                  x1="16.5"
                  y1="16.5"
                  x2="20"
                  y2="20"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <div style={headerStyles.historyControls}>
              <button
                type="button"
                style={{
                  ...headerStyles.historyButton,
                  color: canNavigateBack ? "#404144ff" : "#d4d4d8",
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
                  color: canNavigateForward ? "#404144ff" : "#d4d4d8",
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
        </div>
        {searchErrorNode}
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
    padding: "0.75rem 0 0.5rem 0"
  },
  breadcrumbBar: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem"
  },
  breadcrumbMeasurements: {
    position: "absolute",
    top: 0,
    left: 0,
    visibility: "hidden",
    pointerEvents: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: "0.5rem",
    maxWidth: "none"
  },
  breadcrumbMeasureItem: {
    display: "inline-flex",
    alignItems: "center",
    fontFamily: "inherit",
    fontSize: "0.875rem",
    fontWeight: 500,
    whiteSpace: "nowrap",
    flex: "0 0 auto"
  },
  breadcrumbMeasureHomeItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    fontFamily: "inherit",
    fontSize: "0.875rem",
    fontWeight: 500,
    whiteSpace: "nowrap",
    flex: "0 0 auto"
  },
  breadcrumbRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem"
  },
  primarySection: {
    flex: 1,
    minWidth: 0
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
    color: "#aaabad",
    outline: "none"
  },
  breadcrumbButton: {
    border: "none",
    background: "none",
    color: "#aaabad",
    font: "inherit",
    padding: 0,
    cursor: "pointer",
    whiteSpace: "nowrap",
    outline: "none"
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
    gap: "0.25rem",
    outline: "none"
  },
  breadcrumbCurrent: {
    color: "#aaabad",
    fontWeight: 400,
    whiteSpace: "nowrap"
  },
  breadcrumbHomeCurrent: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem"
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
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: "0.375rem"
  },
  searchToggleButton: {
    border: "none",
    backgroundColor: "transparent",
    padding: 0,
    width: "1.75rem",
    height: "1.75rem",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color: "#404144ff",
    outline: "none"
  },
  searchToggleButtonActive: {
    backgroundColor: "#f1f5f9",
    borderRadius: "9999px"
  },
  searchIconGlyph: {
    width: "1.1rem",
    height: "1.1rem"
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
    background: "none",
    outline: "none"
  },
  searchBar: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    width: "100%"
  },
  searchForm: {
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    border: "1px solid #aaabad",
    borderRadius: "9999px",
    padding: "0.125rem 0.75rem",
    backgroundColor: "#ffffff"
  },
  searchClearButton: {
    border: "none",
    background: "none",
    color: "#6b7280",
    fontSize: "0.875rem",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    width: "1rem",
    height: "1rem",
    marginLeft: "0.5rem",
    marginRight: "0.25rem",
    outline: "none"
  },
  searchInput: {
    flex: 1,
    border: "none",
    background: "none",
    font: "inherit",
    color: "#404144",
    outline: "none",
    padding: "0.125rem 0",
    minWidth: 0
  },
  searchFeedback: {
    margin: "-0.25rem 0 0 1.5rem",
    fontSize: "0.75rem",
    color: "#b91c1c"
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
    color: "#aaabad",
    outline: "none"
  },
  focusTitle: {
    margin: 0,
    fontFamily: "inherit",
    fontSize: "1.25rem",
    fontWeight: 600,
    color: "#111827"
  }
};
