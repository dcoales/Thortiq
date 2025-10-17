import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRef } from "react";

import type { NodeMetadata } from "@thortiq/client-core";

import { OutlineVirtualList } from "../OutlineVirtualList";
import type { OutlineRow } from "../useOutlineRows";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: vi.fn((options: { count: number; estimateSize: () => number }) => {
    const size = options.estimateSize();
    const itemCount = Math.min(options.count, 5);
    const items = Array.from({ length: itemCount }, (_, index) => ({
      index,
      start: index * size
    }));
    return {
      measureElement: vi.fn(),
      getVirtualItems: () => items,
      getTotalSize: () => size * options.count
    };
  })
}));

const ESTIMATED_ROW_HEIGHT = 32;

const createRow = (index: number): OutlineRow => ({
  edgeId: `edge-${index}`,
  canonicalEdgeId: `edge-${index}`,
  nodeId: `node-${index}`,
  depth: 0,
  treeDepth: 0,
  text: `Row ${index}`,
  inlineContent: [],
  metadata: {
    createdAt: 0,
    updatedAt: 0,
    tags: [],
    layout: "standard"
  } as NodeMetadata,
  listOrdinal: null,
  collapsed: false,
  parentNodeId: null,
  hasChildren: false,
  ancestorEdgeIds: [],
  ancestorNodeIds: [],
  mirrorOfNodeId: null,
  mirrorCount: 0,
  showsSubsetOfChildren: false,
  search: undefined
});

interface TestHarnessProps {
  readonly rows: readonly OutlineRow[];
  readonly virtualizationDisabled?: boolean;
  readonly footer?: JSX.Element;
}

const TestHarness = ({ rows, virtualizationDisabled = false, footer }: TestHarnessProps): JSX.Element => {
  const parentRef = useRef<HTMLDivElement | null>(null);
  return (
    <OutlineVirtualList
      rows={rows}
      scrollParentRef={parentRef}
      renderRow={({ row }) => (
        <div data-outline-row="true" data-edge-id={row.edgeId}>
          {row.text}
        </div>
      )}
      virtualizationDisabled={virtualizationDisabled}
      estimatedRowHeight={ESTIMATED_ROW_HEIGHT}
      overscan={4}
      initialRect={{ width: 480, height: 160 }}
      scrollContainerProps={{
        style: {
          maxHeight: "160px",
          overflowY: "auto"
        }
      }}
      footer={footer}
    />
  );
};

describe("OutlineVirtualList", () => {
  it("renders every row and skips virtualization when disabled", () => {
    const rows = Array.from({ length: 6 }, (_, index) => createRow(index));
    const footer = <div data-testid="virtual-footer" />;

    const { container, getByTestId } = render(
      <TestHarness rows={rows} virtualizationDisabled footer={footer} />
    );

    const staticWrappers = container.querySelectorAll('[data-outline-virtual-row="static"]');
    expect(staticWrappers.length).toBe(rows.length);

    const renderedRows = container.querySelectorAll('[data-outline-row="true"]');
    expect(renderedRows.length).toBe(rows.length);

    expect(container.querySelector('[data-outline-virtual-total="true"]')).toBeNull();
    expect(getByTestId("virtual-footer")).toBeTruthy();
  });

  it("window renders rows and exposes a total height container when enabled", () => {
    const rows = Array.from({ length: 100 }, (_, index) => createRow(index));

    const { container } = render(<TestHarness rows={rows} />);

    const wrappers = container.querySelectorAll('[data-outline-virtual-row="virtual"]');
    expect(wrappers.length).toBe(Math.min(rows.length, 5));

    const totalContainer = container.querySelector('[data-outline-virtual-total="true"]');
    expect(totalContainer).not.toBeNull();
  });
});
