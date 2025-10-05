import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { NodeMetadata } from "@thortiq/client-core";
import type { OutlinePresenceParticipant } from "@thortiq/client-core";
import type { FocusPanePayload } from "@thortiq/sync-core";

import { OutlineRowView } from "../OutlineRowView";
import type { OutlineRow } from "../../useOutlineRows";

const createRow = (overrides: Partial<OutlineRow> = {}): OutlineRow => {
  const { inlineContent = [], metadata: metadataOverride, ...restOverrides } = overrides;
  const metadata = (metadataOverride ?? {}) as NodeMetadata;
  return {
    edgeId: "edge-root",
    nodeId: "node-root",
    depth: 0,
    treeDepth: 0,
    text: "Root",
    inlineContent,
    metadata,
    collapsed: false,
    parentNodeId: null,
    hasChildren: false,
    ancestorEdgeIds: [],
    ancestorNodeIds: [],
    ...restOverrides
  } satisfies OutlineRow;
};

describe("OutlineRowView", () => {
  it("renders remote presence indicators", () => {
    const presence: OutlinePresenceParticipant[] = [
      {
        clientId: 1,
        userId: "user-local",
        color: "#ff0000",
        displayName: "Local",
        focusEdgeId: null,
        isLocal: true
      },
      {
        clientId: 2,
        userId: "user-remote",
        color: "#00ff00",
        displayName: "Remote",
        focusEdgeId: null,
        isLocal: false
      }
    ];

    const { container } = render(
      <OutlineRowView
        row={createRow()}
        isSelected={false}
        isPrimarySelected={false}
        highlightSelected={false}
        editorEnabled={false}
        editorAttachedEdgeId={null}
        presence={presence}
        dropIndicator={null}
        onSelect={vi.fn()}
        onToggleCollapsed={vi.fn()}
      />
    );

    const indicators = container.querySelectorAll('[data-outline-presence-indicator="true"]');
    expect(indicators).toHaveLength(1);
    expect(indicators[0]?.getAttribute("title")).toBe("Remote is viewing this node");
  });

  it("invokes handlers for pointer capture and focus", () => {
    const onSelect = vi.fn();
    const onPointerCapture = vi.fn();
    const onFocusEdge: (payload: FocusPanePayload) => void = vi.fn();

    render(
      <OutlineRowView
        row={createRow({
          edgeId: "child-edge",
          nodeId: "child-node",
          depth: 1,
          treeDepth: 1,
          ancestorEdgeIds: ["edge-root"],
          ancestorNodeIds: ["node-root"],
          hasChildren: false
        })}
        isSelected={false}
        isPrimarySelected={false}
        highlightSelected={false}
        editorEnabled={false}
        editorAttachedEdgeId={null}
        presence={[]}
        dropIndicator={null}
        onSelect={onSelect}
        onToggleCollapsed={vi.fn()}
        onRowPointerDownCapture={onPointerCapture}
        onFocusEdge={onFocusEdge}
      />
    );

    const treeItem = document.querySelector('[data-outline-row="true"]') as HTMLElement;
    fireEvent.pointerDown(treeItem, { pointerId: 42, isPrimary: true, button: 0 });
    expect(onPointerCapture).toHaveBeenCalledTimes(1);
    expect(onPointerCapture.mock.calls[0][1]).toBe("child-edge");

    const bulletButton = document.querySelector('[data-outline-bullet]') as HTMLButtonElement;
    fireEvent.click(bulletButton);
    expect(onFocusEdge).toHaveBeenCalledWith({ edgeId: "child-edge", pathEdgeIds: ["edge-root", "child-edge"] });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("passes the edge id to collapse toggles", () => {
    const onSelect = vi.fn();
    const onToggleCollapsed = vi.fn();

    render(
      <OutlineRowView
        row={createRow({
          edgeId: "edge-with-children",
          hasChildren: true,
          collapsed: true
        })}
        isSelected={false}
        isPrimarySelected={false}
        highlightSelected={false}
        editorEnabled={false}
        editorAttachedEdgeId={null}
        presence={[]}
        dropIndicator={null}
        onSelect={onSelect}
        onToggleCollapsed={onToggleCollapsed}
      />
    );

    const toggle = document.querySelector('[data-outline-toggle="true"]') as HTMLButtonElement;
    fireEvent.click(toggle);

    expect(onToggleCollapsed).toHaveBeenCalledWith("edge-with-children", false);
    expect(onSelect).toHaveBeenCalledWith("edge-with-children");
  });

  it("stops row focus when activating a wiki link button", () => {
    const onSelect = vi.fn();
    const onRowMouseDown = vi.fn();
    const onRowPointerDownCapture = vi.fn();
    const onWikiLinkClick = vi.fn();

    render(
      <OutlineRowView
        row={createRow({
          inlineContent: [
            {
              text: "Linked",
              marks: [
                {
                  type: "wikilink",
                  attrs: { nodeId: "target-node" }
                }
              ]
            }
          ]
        })}
        isSelected={false}
        isPrimarySelected={false}
        highlightSelected={false}
        editorEnabled={false}
        editorAttachedEdgeId={null}
        presence={[]}
        dropIndicator={null}
        onSelect={onSelect}
        onToggleCollapsed={vi.fn()}
        onRowMouseDown={onRowMouseDown}
        onRowPointerDownCapture={onRowPointerDownCapture}
        onWikiLinkClick={onWikiLinkClick}
      />
    );

    const linkButton = document.querySelector('[data-outline-wikilink="true"]') as HTMLButtonElement;

    fireEvent.pointerDown(linkButton, { pointerId: 1, button: 0 });
    fireEvent.mouseDown(linkButton);
    fireEvent.click(linkButton);

    expect(onRowMouseDown).not.toHaveBeenCalled();
    expect(onRowPointerDownCapture).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onWikiLinkClick).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceNodeId: "node-root",
        targetNodeId: "target-node"
      })
    );
  });
});
