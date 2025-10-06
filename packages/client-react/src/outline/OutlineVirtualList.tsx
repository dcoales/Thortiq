/**
 * Shared virtualization adapter that keeps DOM measurement and windowing rules close to the
 * outline view layer. Consumers provide row view content and event handlers while this component
 * manages @tanstack/react-virtual wiring, scroll container refs, and fallback rendering when
 * virtualization needs to be disabled (e.g. deterministic test harnesses).
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type {
  CSSProperties,
  HTMLAttributes,
  MutableRefObject,
  ReactNode
} from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";

import type { OutlineRow } from "./useOutlineRows";

export interface OutlineVirtualRowRendererProps {
  readonly row: OutlineRow;
  readonly index: number;
  readonly isVirtual: boolean;
}

export interface OutlineVirtualListProps {
  readonly rows: readonly OutlineRow[];
  readonly scrollParentRef: MutableRefObject<HTMLDivElement | null>;
  readonly renderRow: (props: OutlineVirtualRowRendererProps) => JSX.Element;
  readonly virtualizationDisabled?: boolean;
  readonly estimatedRowHeight: number;
  readonly overscan?: number;
  readonly initialRect?: { readonly width: number; readonly height: number };
  readonly scrollContainerProps?: Omit<HTMLAttributes<HTMLDivElement>, "ref">;
  readonly virtualRowStyle?: CSSProperties;
  readonly staticRowStyle?: CSSProperties;
  readonly footer?: ReactNode;
}

const DEFAULT_OVERSCAN = 8;
const DEFAULT_INITIAL_RECT = { width: 960, height: 480 } as const;

export const OutlineVirtualList = ({
  rows,
  scrollParentRef,
  renderRow,
  virtualizationDisabled = false,
  estimatedRowHeight,
  overscan = DEFAULT_OVERSCAN,
  initialRect = DEFAULT_INITIAL_RECT,
  scrollContainerProps,
  virtualRowStyle,
  staticRowStyle,
  footer
}: OutlineVirtualListProps): JSX.Element => {
  const { style: scrollContainerStyle, ...restContainerProps } = scrollContainerProps ?? {};

  const virtualizer = useVirtualizer({
    count: virtualizationDisabled ? 0 : rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan,
    measureElement: (element) => element.getBoundingClientRect().height,
    initialRect,
    getItemKey: (index) => rows[index]?.edgeId ?? index
  });

  const virtualRowRefs = useRef(new Map<number, HTMLDivElement>());

  const derivedVirtualRowStyle = useMemo<CSSProperties>(() => ({
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    display: "flex",
    alignItems: "stretch",
    minHeight: `${estimatedRowHeight}px`,
    ...virtualRowStyle
  }), [estimatedRowHeight, virtualRowStyle]);

  const derivedStaticRowStyle = useMemo<CSSProperties>(() => ({
    display: "flex",
    alignItems: "stretch",
    minHeight: `${estimatedRowHeight}px`,
    ...staticRowStyle
  }), [estimatedRowHeight, staticRowStyle]);

  const virtualItems = virtualizationDisabled ? [] : virtualizer.getVirtualItems();
  const totalHeight = virtualizationDisabled ? rows.length * estimatedRowHeight : virtualizer.getTotalSize();

  // Track mounted virtual row elements so we can trigger re-measurement after data transforms (search, collapse).
  const handleVirtualRowRef = useCallback((index: number, element: HTMLDivElement | null) => {
    const refs = virtualRowRefs.current;
    if (element) {
      refs.set(index, element);
      virtualizer.measureElement(element);
      return;
    }
    refs.delete(index);
  }, [virtualizer]);

  // Force TanStack to recompute cached heights for visible rows when their content changes without remounting.
  useEffect(() => {
    const measuredVirtualItems = virtualizationDisabled ? [] : virtualizer.getVirtualItems();
    if (virtualizationDisabled || virtualRowRefs.current.size === 0 || measuredVirtualItems.length === 0) {
      return;
    }
    const timeoutId = setTimeout(() => {
      virtualRowRefs.current.forEach((element) => {
        virtualizer.measureElement(element);
      });
    }, 0);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [virtualizationDisabled, virtualizer, rows]);

  const renderVirtualRow = (virtualRow: VirtualItem): JSX.Element | null => {
    const row = rows[virtualRow.index];
    if (!row) {
      return null;
    }
    return (
      <div
        key={row.edgeId}
        ref={(element) => handleVirtualRowRef(virtualRow.index, element)}
        data-index={virtualRow.index}
        data-outline-virtual-row="virtual"
        style={{
          ...derivedVirtualRowStyle,
          transform: `translateY(${virtualRow.start}px)`
        }}
      >
        {renderRow({
          row,
          index: virtualRow.index,
          isVirtual: true
        })}
      </div>
    );
  };

  const renderStaticRow = (row: OutlineRow, index: number): JSX.Element => (
    <div
      key={row.edgeId}
      data-index={index}
      data-outline-virtual-row="static"
      style={derivedStaticRowStyle}
    >
      {renderRow({ row, index, isVirtual: false })}
    </div>
  );

  return (
    <div
      ref={scrollParentRef}
      style={scrollContainerStyle}
      {...restContainerProps}
    >
      {virtualizationDisabled ? (
        rows.map(renderStaticRow)
      ) : (
        <div
          data-outline-virtual-total="true"
          style={{ height: `${totalHeight}px`, position: "relative" }}
        >
          {virtualItems.map(renderVirtualRow)}
        </div>
      )}
      {footer}
    </div>
  );
};
