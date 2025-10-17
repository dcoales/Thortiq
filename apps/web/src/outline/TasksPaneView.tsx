import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutlineActivePaneId, useOutlinePaneState, useOutlineSnapshot, useOutlineStore, useOutlineSessionStore, useSyncContext } from "@thortiq/client-react";
import type { EdgeId, NodeId, OutlineSnapshot } from "@thortiq/client-core";
import { buildTaskPaneRows, type TaskPaneRow } from "@thortiq/client-core";
import { getTasksPaneShowCompleted, setTasksPaneShowCompleted } from "@thortiq/client-core/preferences";
import { getChildEdgeIds, getEdgeSnapshot, parseSearchQuery } from "@thortiq/client-core";
import { ActiveNodeEditor } from "./ActiveNodeEditor";
import type { OutlineSelectionAdapter } from "@thortiq/editor-prosemirror";
import { setTaskDueDate } from "@thortiq/client-core/doc";
import type { OutlineRow } from "@thortiq/client-react";
import { OutlineRowView } from "@thortiq/client-react";
import { toggleTodoDoneCommand } from "@thortiq/outline-commands";

interface TasksPaneViewProps {
  readonly paneId: string;
  readonly style?: CSSProperties;
}

const TasksPaneView = ({ paneId, style }: TasksPaneViewProps): JSX.Element => {
  const snapshot = useOutlineSnapshot();
  const pane = useOutlinePaneState(paneId);
  const outlineStore = useOutlineStore();
  const sessionStore = useOutlineSessionStore();
  const activePaneId = useOutlineActivePaneId();
  const { outline, localOrigin } = useSyncContext();
  const showCompleted = useMemo(() => getTasksPaneShowCompleted(outline), [outline]);
  const isSearchVisible = pane?.search?.isInputVisible ?? false;
  const searchDraft = pane?.search?.draft ?? "";

  const baseRows = useMemo(() => {
    const s = snapshot as OutlineSnapshot;
    return buildTaskPaneRows(s, { showCompleted, includeEmptyNextSevenDaysDays: true }).rows;
  }, [showCompleted, snapshot]);
  const [rows, setRows] = useState<readonly TaskPaneRow[]>(baseRows);
  useEffect(() => {
    const id = setTimeout(() => setRows(baseRows), 100);
    return () => clearTimeout(id);
  }, [baseRows]);

  const selectedEdgeId = sessionStore.getState().selectedEdgeId;
  const paneState = sessionStore.getState().panesById[paneId] ?? null;
  const selectionRange = paneState?.selectionRange ?? null;

  const taskRowEdgeIds = useMemo(() => rows.filter((r) => r.kind === "task").map((r) => r.edgeId), [rows]);

  const computeDraggedEdgeIds = useCallback((primaryEdgeId: string): readonly string[] => {
    if (selectionRange) {
      const anchor = selectionRange.anchorEdgeId;
      const head = selectionRange.headEdgeId;
      const anchorIndex = taskRowEdgeIds.indexOf(anchor);
      const headIndex = taskRowEdgeIds.indexOf(head);
      const primaryIndex = taskRowEdgeIds.indexOf(primaryEdgeId);
      if (anchorIndex >= 0 && headIndex >= 0 && primaryIndex >= 0) {
        const start = Math.min(anchorIndex, headIndex);
        const end = Math.max(anchorIndex, headIndex);
        if (primaryIndex >= start && primaryIndex <= end) {
          return taskRowEdgeIds.slice(start, end + 1);
        }
      }
    }
    return [primaryEdgeId];
  }, [selectionRange, taskRowEdgeIds]);
  const handleSelectEdge = useCallback((edgeId: string | null) => {
    sessionStore.update((state) => {
      if (state.activePaneId !== paneId || state.selectedEdgeId !== edgeId) {
        return { ...state, activePaneId: paneId, selectedEdgeId: edgeId };
      }
      return state;
    });
  }, [paneId, sessionStore]);

  const selectionAdapter = useMemo<OutlineSelectionAdapter>(() => ({
    getPrimaryEdgeId: () => sessionStore.getState().selectedEdgeId,
    getOrderedEdgeIds: () => {
      const id = sessionStore.getState().selectedEdgeId;
      return id ? [id] : [];
    },
    setPrimaryEdgeId: (edgeId) => {
      handleSelectEdge(edgeId ?? null);
    },
    clearRange: () => {
      // No multi-select in Tasks pane initial implementation
    }
  }), [handleSelectEdge, sessionStore]);

  // Shared editor attach target (the active row text cell)
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const [editorAttachedEdgeId, setEditorAttachedEdgeId] = useState<EdgeId | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const runtime = outlineStore.getPaneRuntimeState(paneId);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set(runtime?.tasksCollapsedSections ?? []));
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(() => new Set(runtime?.tasksCollapsedDays ?? []));
  // Per-task expand state (edge-local in runtime for Tasks Pane display)
  const [expandedTaskEdgeIds, setExpandedTaskEdgeIds] = useState<Set<EdgeId>>(() => new Set());

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section); else next.add(section);
      outlineStore.updatePaneRuntimeState(paneId, (previous) => {
        const base = previous ?? { paneId, scrollTop: 0, widthRatio: null, lastFocusedEdgeId: null, virtualizerVersion: 0 };
        return { ...base, tasksCollapsedSections: next };
      });
      return next;
    });
  };
  const toggleDay = (key: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      outlineStore.updatePaneRuntimeState(paneId, (previous) => {
        const base = previous ?? { paneId, scrollTop: 0, widthRatio: null, lastFocusedEdgeId: null, virtualizerVersion: 0 };
        return { ...base, tasksCollapsedDays: next };
      });
      return next;
    });
  };

  const toUtcMidnight = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const parseIsoDay = (isoDay: string): Date => new Date(`${isoDay}T00:00:00.000Z`);

  const handleDropReschedule = useCallback((edgeIds: readonly string[], payload: { type: "day"; isoDay: string } | { type: "section"; section: "Today" | "NextSevenDays" | "Later" }) => {
    let targetDate: Date | null = null;
    const today = toUtcMidnight(new Date());
    if (payload.type === "day") {
      targetDate = parseIsoDay(payload.isoDay);
    } else {
      if (payload.section === "Today") {
        targetDate = today;
      } else if (payload.section === "NextSevenDays") {
        targetDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, 0, 0, 0, 0));
      } else if (payload.section === "Later") {
        targetDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 8, 0, 0, 0, 0));
      }
    }
    if (!targetDate) return;
    for (const edgeId of edgeIds) {
      try {
        const snap = getEdgeSnapshot(outline, edgeId as string);
        setTaskDueDate(outline, snap.childNodeId, targetDate, localOrigin);
      } catch (_e) {
        // ignore bad ids
      }
    }
  }, [localOrigin, outline]);

  // Build a map for mirror counts by node id to display mirror indicator parity with Outline
  const mirrorCountByNodeId = useMemo(() => {
    const counts = new Map<NodeId, number>();
    (snapshot as OutlineSnapshot).edges.forEach((edge) => {
      if (edge.mirrorOfNodeId) {
        const current = counts.get(edge.mirrorOfNodeId as NodeId) ?? 0;
        counts.set(edge.mirrorOfNodeId as NodeId, current + 1);
      }
    });
    return counts as ReadonlyMap<NodeId, number>;
  }, [snapshot]);

  const isTaskExpanded = useCallback((edgeId: EdgeId) => expandedTaskEdgeIds.has(edgeId), [expandedTaskEdgeIds]);
  const setTaskExpanded = useCallback((edgeId: EdgeId, expanded: boolean) => {
    setExpandedTaskEdgeIds((prev) => {
      const next = new Set(prev);
      if (expanded) next.add(edgeId); else next.delete(edgeId);
      return next;
    });
  }, []);

  // Project a task or child edge into an OutlineRow to reuse OutlineRowView renderer
  const toOutlineRow = useCallback((edgeId: EdgeId, depth: number, ancestorEdgeIds: readonly EdgeId[]): OutlineRow => {
    const snap = getEdgeSnapshot(outline, edgeId);
    const node = (snapshot as OutlineSnapshot).nodes.get(snap.childNodeId)!;
    const childEdgeIds = getChildEdgeIds(outline, snap.childNodeId);
    const hasChildren = childEdgeIds.length > 0;
    const collapsed = hasChildren ? !isTaskExpanded(edgeId) : false;
    const ancestorNodeIds: NodeId[] = ancestorEdgeIds
      .map((id) => getEdgeSnapshot(outline, id).childNodeId) as NodeId[];
    const mirrorCount = mirrorCountByNodeId.get(node.id as NodeId) ?? 0;
    return {
      edgeId: edgeId as EdgeId,
      canonicalEdgeId: snap.canonicalEdgeId as EdgeId,
      nodeId: node.id as NodeId,
      depth,
      treeDepth: depth,
      text: node.text,
      inlineContent: node.inlineContent,
      metadata: node.metadata,
      listOrdinal: null,
      collapsed,
      parentNodeId: ancestorNodeIds.length > 0 ? ancestorNodeIds[ancestorNodeIds.length - 1] : null,
      hasChildren,
      ancestorEdgeIds: ancestorEdgeIds as EdgeId[],
      ancestorNodeIds,
      mirrorOfNodeId: snap.mirrorOfNodeId as NodeId | null,
      mirrorCount,
      showsSubsetOfChildren: false,
      search: undefined
    } satisfies OutlineRow;
  }, [outline, snapshot, isTaskExpanded, mirrorCountByNodeId]);

  // Expand selected Edge children for display in Tasks Pane
  const expandTaskChildren = useCallback((taskEdgeId: EdgeId, baseDepth: number, baseAncestors: readonly EdgeId[]) => {
    const result: OutlineRow[] = [];
    const queue: Array<{ edgeId: EdgeId; depth: number; ancestors: EdgeId[] }> = [];
    const childEdges = getChildEdgeIds(outline, getEdgeSnapshot(outline, taskEdgeId).childNodeId);
    childEdges.forEach((childEdgeId) => queue.push({ edgeId: childEdgeId as EdgeId, depth: baseDepth + 1, ancestors: [...baseAncestors, taskEdgeId] as EdgeId[] }));

    while (queue.length > 0) {
      const { edgeId, depth, ancestors } = queue.shift()!;
      const row = toOutlineRow(edgeId, depth, ancestors);
      result.push(row);
      if (row.hasChildren && isTaskExpanded(edgeId)) {
        const grandchildren = getChildEdgeIds(outline, row.nodeId);
        grandchildren.forEach((gc) => queue.push({ edgeId: gc as EdgeId, depth: depth + 1, ancestors: [...ancestors, edgeId] as EdgeId[] }));
      }
    }
    return result;
  }, [outline, toOutlineRow, isTaskExpanded]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.25rem 0.5rem", gap: "0.5rem" }}>
        <div style={{ flex: 1 }}>
          {!isSearchVisible ? (
            <button
              aria-label="Search tasks"
              onClick={() => {
                sessionStore.update((state) => {
                  const current = state.panesById[paneId];
                  if (!current) return state;
                  return {
                    ...state,
                    panesById: {
                      ...state.panesById,
                      [paneId]: { ...current, search: { ...current.search, isInputVisible: true } }
                    }
                  };
                });
              }}
              style={{ padding: "0.25rem 0.5rem", border: "1px solid #9ca3af", borderRadius: "4px", background: "white" }}
            >
              🔍 Search
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const input = (e.currentTarget.elements.namedItem("q") as HTMLInputElement) ?? null;
                const value = input ? input.value : "";
                if (value.trim().length === 0) {
                  outlineStore.clearPaneSearch(paneId);
                  return;
                }
                try {
                  const parsed = parseSearchQuery(value);
                  if (parsed.type === "success") {
                    outlineStore.runPaneSearch(paneId, { query: value, expression: parsed.expression });
                  } else {
                    outlineStore.clearPaneSearch(paneId);
                  }
                } catch {
                  outlineStore.clearPaneSearch(paneId);
                }
              }}
              style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}
            >
              <button
                type="button"
                aria-label="Close search"
                onClick={() => {
                  // If draft has content, clear; else close search
                  const current = sessionStore.getState().panesById[paneId];
                  if (current && current.search.draft && current.search.draft.length > 0) {
                    outlineStore.clearPaneSearch(paneId);
                    sessionStore.update((state) => {
                      const pane = state.panesById[paneId];
                      if (!pane) return state;
                      return {
                        ...state,
                        panesById: {
                          ...state.panesById,
                          [paneId]: { ...pane, search: { ...pane.search, draft: "", submitted: null, resultEdgeIds: [] } }
                        }
                      };
                    });
                  } else {
                    sessionStore.update((state) => {
                      const pane = state.panesById[paneId];
                      if (!pane) return state;
                      return {
                        ...state,
                        panesById: {
                          ...state.panesById,
                          [paneId]: { ...pane, search: { ...pane.search, isInputVisible: false, draft: "", submitted: null, resultEdgeIds: [] } }
                        }
                      };
                    });
                  }
                }}
                style={{ padding: "0.25rem 0.5rem", border: "1px solid #9ca3af", borderRadius: "4px", background: "white" }}
              >
                ✕
              </button>
              <input
                name="q"
                defaultValue={searchDraft}
                placeholder="Search tasks..."
                style={{ flex: 1, padding: "0.25rem 0.5rem", border: "1px solid #9ca3af", borderRadius: "4px" }}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  sessionStore.update((state) => {
                    const pane = state.panesById[paneId];
                    if (!pane) return state;
                    return {
                      ...state,
                      panesById: {
                        ...state.panesById,
                        [paneId]: { ...pane, search: { ...pane.search, draft: value } }
                      }
                    };
                  });
                }}
              />
              <button type="submit" style={{ padding: "0.25rem 0.5rem", border: "1px solid #9ca3af", borderRadius: "4px", background: "white" }}>Go</button>
            </form>
          )}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setTasksPaneShowCompleted(outline, e.target.checked, localOrigin)}
          />
          Show Completed
        </label>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {rows.map((row) => {
          if (row.kind === "sectionHeader") {
            const isCollapsed = collapsedSections.has(row.section);
            return (
              <div
                key={row.key}
                role="button"
                tabIndex={0}
                style={{ fontWeight: 600, padding: "0.5rem 0.25rem", background: dropTargetKey === row.key ? "#e0f2fe" : undefined, userSelect: "none" }}
                onClick={() => toggleSection(row.section)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSection(row.section); }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropTargetKey(row.key);
                }}
                onDragLeave={() => setDropTargetKey(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropTargetKey(null);
                  const payloadRaw = e.dataTransfer.getData("application/x-thortiq-task-edges");
                  const edges: string[] = payloadRaw ? JSON.parse(payloadRaw) : [];
                  if (edges && edges.length > 0) {
                    const section = row.section === "Today" ? "Today" : row.section === "NextSevenDays" ? "NextSevenDays" : row.section === "Later" ? "Later" : null;
                    if (section) {
                      handleDropReschedule(edges, { type: "section", section });
                    }
                  }
                }}
              >
                {(isCollapsed ? "▶ " : "▼ ")}
                {row.section === "Overdue" ? "Overdue" :
                 row.section === "Today" ? "Today" :
                 row.section === "NextSevenDays" ? "Next seven days" :
                 row.section === "Later" ? "Later" : "Undated"}
              </div>
            );
          }
          if (row.kind === "dayHeader") {
            if (collapsedSections.has(row.section)) {
              return null;
            }
            const isCollapsed = collapsedDays.has(row.key);
            return (
              <div
                key={row.key}
                role="button"
                tabIndex={0}
                style={{ padding: "0.25rem 0.25rem", color: "#6b7280", background: dropTargetKey === row.key ? "#e0f2fe" : undefined, userSelect: "none" }}
                onClick={() => toggleDay(row.key)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleDay(row.key); } }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropTargetKey(row.key);
                }}
                onDragLeave={() => setDropTargetKey(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropTargetKey(null);
                  const payloadRaw = e.dataTransfer.getData("application/x-thortiq-task-edges");
                  const edges: string[] = payloadRaw ? JSON.parse(payloadRaw) : [];
                  if (edges && edges.length > 0) {
                    // key format: day:Section:YYYY-MM-DD
                    const parts = row.key.split(":");
                    const isoDay = parts[2] ?? null;
                    if (isoDay) {
                      handleDropReschedule(edges, { type: "day", isoDay });
                    }
                  }
                }}
              >
                {(isCollapsed ? "▶ " : "▼ ")}{row.label}
              </div>
            );
          }
          const isSelected = selectedEdgeId === row.edgeId;
          const isActivePane = activePaneId === paneId;
          if (collapsedSections.has(row.section)) {
            return null;
          }
          // If the most recent day header above is collapsed, hide tasks until next header
          // Track by scanning backward to find a day header key (cheap for UI)
          let isUnderCollapsedDay = false;
          for (let i = rows.indexOf(row) - 1; i >= 0; i -= 1) {
            const prev = rows[i];
            if (prev.kind === "dayHeader") {
              if (collapsedDays.has(prev.key)) {
                isUnderCollapsedDay = true;
              }
              break;
            }
            if (prev.kind === "sectionHeader") {
              break;
            }
          }
          if (isUnderCollapsedDay) {
            return null;
          }
          // Reuse Outline row rendering for tasks
          const outlineRow = toOutlineRow(row.edgeId as EdgeId, 0, []);
          const handleToggleCollapsed = (edgeId: EdgeId, collapsed?: boolean) => {
            const nextExpanded = collapsed === undefined ? !isTaskExpanded(edgeId) : !collapsed;
            setTaskExpanded(edgeId, nextExpanded);
          };
          const handleSelect = (edgeId: EdgeId) => {
            handleSelectEdge(edgeId);
            setEditorAttachedEdgeId(edgeId);
          };
          const onBulletActivate: NonNullable<Parameters<typeof OutlineRowView>[0]["onBulletActivate"]> = ({ edgeId, event }) => {
            const paneIds = sessionStore.getState().paneOrder;
            const selfIndex = paneIds.indexOf(paneId);
            const leftNeighborId = selfIndex > 0 ? paneIds[selfIndex - 1] : null;
            const openLeft = () => {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const core = require("@thortiq/client-core");
              const { openPaneRightOf } = core;
              const current = sessionStore.getState();
              const { state: next } = openPaneRightOf(current, paneId, { paneKind: "outline", focusEdgeId: edgeId });
              sessionStore.setState(next);
            };
            event.preventDefault();
            event.stopPropagation();
            if (event.shiftKey) {
              if (leftNeighborId) {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const core = require("@thortiq/client-core");
                const { focusPane } = core;
                const focused = focusPane(sessionStore.getState(), leftNeighborId, { edgeId, makeActive: true });
                sessionStore.setState(focused.state);
              } else {
                openLeft();
              }
            } else {
              openLeft();
            }
            return true;
          };

          const outlineNodes: OutlineRow[] = [outlineRow];
          if (outlineRow.hasChildren && isTaskExpanded(outlineRow.edgeId)) {
            outlineNodes.push(...expandTaskChildren(outlineRow.edgeId, outlineRow.depth, outlineRow.ancestorEdgeIds));
          }

          return (
            <div key={row.key} style={{ display: "flex", flexDirection: "column", borderBottom: "1px solid #e5e7eb" }}>
              {outlineNodes.map((orow, index) => {
                const view = (
                  <OutlineRowView
                    key={orow.edgeId}
                    row={orow}
                    isSelected={selectedEdgeId === orow.edgeId}
                    isPrimarySelected={selectedEdgeId === orow.edgeId}
                    onFocusEdge={undefined}
                    highlightSelected={true}
                    editorAttachedEdgeId={editorAttachedEdgeId}
                    isActivePane={isActivePane}
                    onSelect={handleSelect}
                    onToggleCollapsed={handleToggleCollapsed}
                    onToggleTodo={(edgeId) => {
                      toggleTodoDoneCommand({ outline, origin: localOrigin }, [edgeId]);
                    }}
                    editorEnabled={true}
                    presence={[]}
                    onActiveTextCellChange={(edgeId, element) => {
                      if (selectedEdgeId === edgeId) {
                        editorContainerRef.current = element;
                        setEditorAttachedEdgeId(edgeId);
                      }
                    }}
                    onBulletActivate={onBulletActivate}
                  />
                );
                if (index === 0) {
                  return (
                    <div
                      key={`wrap-${orow.edgeId}`}
                      draggable
                      onDragStart={(e) => {
                        const edges = computeDraggedEdgeIds(orow.edgeId);
                        e.dataTransfer.setData("application/x-thortiq-task-edges", JSON.stringify(edges));
                        e.dataTransfer.effectAllowed = "move";
                      }}
                    >
                      {view}
                    </div>
                  );
                }
                return view;
              })}
            </div>
          );
        })}
      </div>
      {/* Shared editor mounted once, attached to active row text cell */}
      {selectedEdgeId && editorContainerRef.current ? (
        <ActiveNodeEditor
          paneId={paneId}
          isActive={activePaneId === paneId}
          nodeId={selectedEdgeId ? getEdgeSnapshot(outline, selectedEdgeId).childNodeId : null}
          container={editorContainerRef.current}
          outlineSnapshot={snapshot as OutlineSnapshot}
          selectionAdapter={selectionAdapter}
          paneMode="tasks"
          activeRow={{
            edgeId: selectedEdgeId as EdgeId,
            canonicalEdgeId: getEdgeSnapshot(outline, selectedEdgeId).canonicalEdgeId as EdgeId,
            nodeId: getEdgeSnapshot(outline, selectedEdgeId).childNodeId as NodeId,
            inlineContent: (snapshot as OutlineSnapshot).nodes.get(getEdgeSnapshot(outline, selectedEdgeId).childNodeId)?.inlineContent ?? [],
            hasChildren: getChildEdgeIds(outline, getEdgeSnapshot(outline, selectedEdgeId).childNodeId).length > 0,
            collapsed: (() => {
              const edge = selectedEdgeId as EdgeId;
              const snap = getEdgeSnapshot(outline, edge);
              const hasKids = getChildEdgeIds(outline, snap.childNodeId).length > 0;
              return hasKids ? !isTaskExpanded(edge) : false;
            })(),
            visibleChildCount: getChildEdgeIds(outline, getEdgeSnapshot(outline, selectedEdgeId).childNodeId).length,
            ancestorEdgeIds: [] as EdgeId[]
          }}
        />
      ) : null}
    </div>
  );
};

export default TasksPaneView;


