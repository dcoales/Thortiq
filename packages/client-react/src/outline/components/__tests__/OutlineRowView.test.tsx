import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { InlineSpan, NodeMetadata } from "@thortiq/client-core";
import type { OutlinePresenceParticipant } from "@thortiq/client-core";
import type { FocusPanePayload } from "@thortiq/sync-core";

import { OutlineRowView, MIRROR_INSTANCE_COLOR, MIRROR_ORIGINAL_COLOR } from "../OutlineRowView";
import type { OutlineRow } from "../../useOutlineRows";

const createRow = (overrides: Partial<OutlineRow> = {}): OutlineRow => {
  const {
    inlineContent = [],
    metadata: metadataOverride,
    listOrdinal = null,
    ...restOverrides
  } = overrides;
  const metadata = {
    createdAt: 0,
    updatedAt: 0,
    tags: [],
    layout: "standard",
    ...(metadataOverride ?? {})
  } as NodeMetadata;
  const edgeId = (restOverrides.edgeId as string | undefined) ?? "edge-root";
  const canonicalEdgeId = (restOverrides.canonicalEdgeId as string | undefined) ?? edgeId;
  return {
    edgeId,
    canonicalEdgeId,
    nodeId: "node-root",
    depth: 0,
    treeDepth: 0,
    text: "Root",
    inlineContent,
    metadata,
    listOrdinal,
    collapsed: false,
    parentNodeId: null,
    hasChildren: false,
    ancestorEdgeIds: [],
    ancestorNodeIds: [],
    mirrorOfNodeId: null,
    mirrorCount: 0,
    showsSubsetOfChildren: false,
    search: undefined,
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

  it("invokes onTagClick when inline tag pills are clicked", () => {
    const onTagClick = vi.fn();
    const inlineContent: InlineSpan[] = [
      {
        text: "#alpha",
        marks: [
          {
            type: "tag",
            attrs: { id: "alpha", trigger: "#", label: "alpha" }
          }
        ]
      }
    ];

    const { getByRole } = render(
      <OutlineRowView
        row={createRow({ inlineContent })}
        isSelected={false}
        isPrimarySelected={false}
        highlightSelected={false}
        editorEnabled={false}
        editorAttachedEdgeId={null}
        presence={[]}
        dropIndicator={null}
        onSelect={vi.fn()}
        onToggleCollapsed={vi.fn()}
        onTagClick={onTagClick}
      />
    );

    const tagButton = getByRole("button", { name: "#alpha" });
    fireEvent.click(tagButton);

    expect(onTagClick).toHaveBeenCalledWith({
      edgeId: "edge-root",
      sourceNodeId: "node-root",
      label: "alpha",
      trigger: "#"
    });
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

  it("renders numbered layout with ordinal markers", () => {
    const { container } = render(
      <OutlineRowView
        row={createRow({
          metadata: { layout: "numbered", createdAt: 0, updatedAt: 0, tags: [] },
          listOrdinal: 3
        })}
        isSelected={false}
        isPrimarySelected={false}
        highlightSelected={false}
        editorEnabled={false}
        editorAttachedEdgeId={null}
        presence={[]}
        dropIndicator={null}
        onSelect={vi.fn()}
        onToggleCollapsed={vi.fn()}
      />
    );

    const bulletButton = container.querySelector('[data-outline-bullet="leaf"]') as HTMLButtonElement;
    expect(bulletButton).not.toBeNull();
    expect(bulletButton.textContent).toBe("3.");
    expect(bulletButton.getAttribute("data-outline-list-ordinal")).toBe("3");
  });

  it("hides paragraph bullets and carets until hover when expanded", () => {
    const { container } = render(
      <OutlineRowView
        row={createRow({
          metadata: { layout: "paragraph", createdAt: 0, updatedAt: 0, tags: [] },
          hasChildren: true,
          collapsed: false
        })}
        isSelected={false}
        isPrimarySelected={false}
        highlightSelected={false}
        editorEnabled={false}
        editorAttachedEdgeId={null}
        presence={[]}
        dropIndicator={null}
        onSelect={vi.fn()}
        onToggleCollapsed={vi.fn()}
      />
    );

    const rowElement = container.querySelector('[data-outline-row="true"]') as HTMLElement;
    const bulletButton = container.querySelector('[data-outline-bullet]') as HTMLButtonElement;
    const caretButton = container.querySelector('[data-outline-toggle="true"]') as HTMLButtonElement;
    expect(bulletButton.style.opacity).toBe("0");
    expect(caretButton.style.opacity).toBe("0");

    fireEvent.pointerEnter(rowElement);
    expect(bulletButton.style.opacity).toBe("1");
    expect(caretButton.style.opacity).toBe("1");

    fireEvent.pointerLeave(rowElement, { buttons: 0 });
    expect(bulletButton.style.opacity).toBe("0");
    expect(caretButton.style.opacity).toBe("0");
  });

  it("keeps paragraph controls visible while collapsed", () => {
    const { container } = render(
      <OutlineRowView
        row={createRow({
          metadata: { layout: "paragraph", createdAt: 0, updatedAt: 0, tags: [] },
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
        onSelect={vi.fn()}
        onToggleCollapsed={vi.fn()}
      />
    );

    const bulletButton = container.querySelector('[data-outline-bullet]') as HTMLButtonElement;
    const caretButton = container.querySelector('[data-outline-toggle="true"]') as HTMLButtonElement;
    expect(bulletButton.style.opacity).toBe("1");
    expect(caretButton.style.opacity).toBe("1");
  });

  it("applies heading styles to static content", () => {
    const inlineContent: InlineSpan[] = [
      {
        text: "Heading text",
        marks: [{ type: "strong", attrs: {} }]
      }
    ];

    const { container } = render(
      <OutlineRowView
        row={createRow({
          inlineContent,
          metadata: { layout: "standard", createdAt: 0, updatedAt: 0, tags: [], headingLevel: 2 }
        })}
        isSelected={false}
        isPrimarySelected={false}
        highlightSelected={false}
        editorEnabled={false}
        editorAttachedEdgeId={null}
        presence={[]}
        dropIndicator={null}
        onSelect={vi.fn()}
        onToggleCollapsed={vi.fn()}
      />
    );

    const textContent = container.querySelector('[data-outline-text-content="true"]') as HTMLElement;
    expect(textContent).not.toBeNull();
    expect(textContent.getAttribute("data-outline-heading-level")).toBe("2");
    expect(textContent.style.fontSize).toBe("1.45rem");
    expect(textContent.style.fontWeight).toBe("700");
    expect(textContent.style.lineHeight).toBe("1.25");

    const strongSpan = textContent.querySelector('[data-outline-mark-strong="true"]') as HTMLElement;
    expect(strongSpan?.style.fontWeight).toBe("700");
  });

  it("renders inline formatting marks in static content", () => {
    const inlineContent: InlineSpan[] = [
      {
        text: "Bold",
        marks: [{ type: "strong", attrs: {} }]
      },
      { text: " ", marks: [] },
      {
        text: "Italic",
        marks: [{ type: "em", attrs: {} }]
      },
      { text: " ", marks: [] },
      {
        text: "Under",
        marks: [{ type: "underline", attrs: {} }]
      },
      { text: " ", marks: [] },
      {
        text: "Color",
        marks: [{ type: "textColor", attrs: { color: "#336699cc" } }]
      },
      { text: " ", marks: [] },
      {
        text: "Highlight",
        marks: [{ type: "backgroundColor", attrs: { color: "#ffee00aa" } }]
      }
    ];

    const { container } = render(
      <OutlineRowView
        row={createRow({ inlineContent })}
        isSelected={false}
        isPrimarySelected={false}
        highlightSelected={false}
        editorEnabled={false}
        editorAttachedEdgeId={null}
        presence={[]}
        dropIndicator={null}
        onSelect={vi.fn()}
        onToggleCollapsed={vi.fn()}
      />
    );

    const staticContent = container.querySelector('[data-outline-text-content="true"]');
    expect(staticContent?.textContent).toBe("Bold Italic Under Color Highlight");

    const boldSpan = staticContent?.querySelector('[data-outline-mark-strong="true"]') as HTMLElement;
    expect(boldSpan?.style.fontWeight).toBe("600");

    const italicSpan = staticContent?.querySelector('[data-outline-mark-em="true"]') as HTMLElement;
    expect(italicSpan?.style.fontStyle).toBe("italic");

    const underlineSpan = staticContent?.querySelector('[data-outline-mark-underline="true"]') as HTMLElement;
    expect(underlineSpan?.style.textDecoration).toContain("underline");

    const colorSpan = staticContent?.querySelector('[data-outline-mark-text-color]') as HTMLElement;
    expect(colorSpan?.getAttribute("data-outline-mark-text-color")).toBe("#336699cc");

    const highlightSpan = staticContent?.querySelector('[data-outline-mark-background-color]') as HTMLElement;
    expect(highlightSpan?.getAttribute("data-outline-mark-background-color")).toBe("#ffee00aa");
  });

  it("renders a partial caret when only a subset of children are visible", () => {
    const onToggleCollapsed = vi.fn();

    const { getByLabelText } = render(
      <OutlineRowView
        row={createRow({
          hasChildren: true,
          collapsed: false,
          showsSubsetOfChildren: true,
          search: { kind: "match", isPartial: true }
        })}
        isSelected={false}
        isPrimarySelected={false}
        highlightSelected={false}
        editorEnabled={false}
        editorAttachedEdgeId={null}
        presence={[]}
        dropIndicator={null}
        onSelect={vi.fn()}
        onToggleCollapsed={onToggleCollapsed}
      />
    );

    const toggle = getByLabelText("Show all children") as HTMLButtonElement;
    const caretWrapper = toggle.querySelector("span");
    expect(caretWrapper?.style.transform).toBe("rotate(45deg)");

    fireEvent.click(toggle);
    expect(onToggleCollapsed).toHaveBeenCalledWith("edge-root", true);
  });

  it("renders an orange halo for original nodes with mirrors", () => {
    render(
      <OutlineRowView
        row={createRow({
          edgeId: "edge-original",
          nodeId: "node-original",
          mirrorOfNodeId: null,
          mirrorCount: 2
        })}
        isSelected={false}
        isPrimarySelected={false}
        highlightSelected={false}
        editorEnabled={false}
        editorAttachedEdgeId={null}
        presence={[]}
        dropIndicator={null}
        onSelect={vi.fn()}
        onToggleCollapsed={vi.fn()}
      />
    );

    const bullet = document.querySelector('[data-outline-bullet-halo="original"]') as HTMLButtonElement;
    expect(bullet).not.toBeNull();
    expect(bullet.style.boxShadow).toContain(MIRROR_ORIGINAL_COLOR);
  });

  it("renders a blue halo for mirror nodes", () => {
    render(
      <OutlineRowView
        row={createRow({
          edgeId: "edge-mirror",
          nodeId: "node-shared",
          mirrorOfNodeId: "node-source",
          mirrorCount: 1
        })}
        isSelected={false}
        isPrimarySelected={false}
        highlightSelected={false}
        editorEnabled={false}
        editorAttachedEdgeId={null}
        presence={[]}
        dropIndicator={null}
        onSelect={vi.fn()}
        onToggleCollapsed={vi.fn()}
      />
    );

    const bullet = document.querySelector('[data-outline-bullet-halo="mirror"]') as HTMLButtonElement;
    expect(bullet).not.toBeNull();
    expect(bullet.style.boxShadow).toContain(MIRROR_INSTANCE_COLOR);
  });

  it("renders a mirror tracker indicator and forwards click events", () => {
    const onMirrorIndicatorClick = vi.fn();

    render(
      <OutlineRowView
        row={createRow({
          edgeId: "edge-original",
          nodeId: "node-original",
          mirrorOfNodeId: null,
          mirrorCount: 3
        })}
        isSelected={false}
        isPrimarySelected={false}
        highlightSelected={false}
        editorEnabled={false}
        editorAttachedEdgeId={null}
        presence={[]}
        dropIndicator={null}
        onSelect={vi.fn()}
        onToggleCollapsed={vi.fn()}
        onMirrorIndicatorClick={onMirrorIndicatorClick}
      />
    );

    const indicator = document.querySelector('[data-outline-mirror-indicator="true"]') as HTMLButtonElement;
    expect(indicator).not.toBeNull();
    expect(indicator.textContent).toBe("3");
   fireEvent.click(indicator);
   expect(onMirrorIndicatorClick).toHaveBeenCalledTimes(1);
   expect(onMirrorIndicatorClick.mock.calls[0][0]?.row.edgeId).toBe("edge-original");
 });

  it("renders wiki link spans as buttons and forwards events without toggling selection", () => {
    const onSelect = vi.fn();
    const onPointerCapture = vi.fn();
    const onWikiLinkClick = vi.fn();
    const row = createRow({
      edgeId: "edge-with-wikilink",
      nodeId: "source-node",
      inlineContent: [
        {
          text: "Example",
          marks: [
            {
              type: "wikilink",
              attrs: { nodeId: "target-node" }
            }
          ]
        } satisfies InlineSpan
      ]
    });

    render(
      <OutlineRowView
        row={row}
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
        onWikiLinkClick={onWikiLinkClick}
      />
    );

    const button = document.querySelector('[data-outline-wikilink="true"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    fireEvent.pointerDown(button);
    expect(onPointerCapture).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onWikiLinkClick).toHaveBeenCalledTimes(1);
    expect(onWikiLinkClick).toHaveBeenCalledWith(
      expect.objectContaining({
        edgeId: "edge-with-wikilink",
        sourceNodeId: "source-node",
        targetNodeId: "target-node",
        displayText: "Example",
        segmentIndex: 0
      })
    );
  });
});
