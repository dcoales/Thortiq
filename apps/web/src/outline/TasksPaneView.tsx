import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutlineActivePaneId, useOutlinePaneState, useOutlineSnapshot, useOutlineStore, useOutlineSessionStore, useSyncContext, usePaneSearch, PaneSearchBar, PANE_HEADER_BASE_STYLE, PANE_HEADER_ACTIVE_STYLE, PaneHeaderActions } from "@thortiq/client-react";
import { FONT_FAMILY_STACK } from "../theme/typography";
import type { EdgeId, NodeId, OutlineSnapshot } from "@thortiq/client-core";
import { buildTaskPaneRows, type TaskPaneRow } from "@thortiq/client-core";
import { getTasksPaneShowCompleted, setTasksPaneShowCompleted } from "@thortiq/client-core/preferences";
import { getChildEdgeIds, getEdgeSnapshot, closePane, openPaneRightOf, focusPane } from "@thortiq/client-core";
import { ActiveNodeEditor } from "./ActiveNodeEditor";
import type { OutlineSelectionAdapter } from "@thortiq/editor-prosemirror";
import type { PendingCursorRequest } from "./ActiveNodeEditor";
import { setTaskDueDate, setTasksDueDate, clearTaskDueDate, clearTasksDueDate } from "@thortiq/client-core/doc/tasks";
import type { OutlineRow } from "@thortiq/client-react";
import { OutlineRowView } from "@thortiq/client-react";
import { toggleTodoDoneCommand } from "@thortiq/outline-commands";
import { usePaneSessionController } from "./hooks/usePaneSessionController";
import { useRowDragSelection, DatePickerPopover } from "@thortiq/client-react";

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
  const paneSearch = usePaneSearch(paneId, pane ?? undefined);

  const baseRows = useMemo(() => {
    const s = snapshot as OutlineSnapshot;
    return buildTaskPaneRows(s, { showCompleted, includeEmptyNextSevenDaysDays: true }).rows;
  }, [showCompleted, snapshot]);
  const [rows, setRows] = useState<readonly TaskPaneRow[]>(baseRows);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  useEffect(() => {
    if (isEditorFocused) {
      return;
    }
    const id = setTimeout(() => setRows(baseRows), 100);
    return () => clearTimeout(id);
  }, [baseRows, isEditorFocused]);

  const selectedEdgeId = sessionStore.getState().selectedEdgeId;
  const paneState = sessionStore.getState().panesById[paneId] ?? null;
  const selectionRange = paneState?.selectionRange ?? null;

  const sessionController = usePaneSessionController({ sessionStore, paneId });
  const { setSelectionRange, setActiveEdge: setSelectedEdgeId } = sessionController as unknown as {
    setSelectionRange: (range: { anchorEdgeId: EdgeId; focusEdgeId: EdgeId } | null) => void;
    setActiveEdge: (edgeId: EdgeId | null, options?: { preserveRange?: boolean }) => void;
  };

  const taskRowEdgeIds = useMemo(() => rows.filter((r): r is Extract<TaskPaneRow, { kind: "task" }> => r.kind === "task").map((r) => r.edgeId), [rows]);

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
      const range = sessionStore.getState().panesById[paneId]?.selectionRange;
      if (!range) {
        const id = sessionStore.getState().selectedEdgeId;
        return id ? [id] : [];
      }
      const anchorIndex = taskRowEdgeIds.indexOf(range.anchorEdgeId as EdgeId);
      const headIndex = taskRowEdgeIds.indexOf(range.headEdgeId as EdgeId);
      if (anchorIndex < 0 || headIndex < 0) {
        const id = sessionStore.getState().selectedEdgeId;
        return id ? [id] : [];
      }
      const start = Math.min(anchorIndex, headIndex);
      const end = Math.max(anchorIndex, headIndex);
      return taskRowEdgeIds.slice(start, end + 1) as EdgeId[];
    },
    setPrimaryEdgeId: (edgeId) => {
      handleSelectEdge(edgeId ?? null);
    },
    clearRange: () => {
      sessionController.setSelectionRange(null as unknown as { anchorEdgeId: EdgeId; focusEdgeId: EdgeId } | null);
    }
  }), [handleSelectEdge, paneId, sessionController, sessionStore, taskRowEdgeIds]);

  // Shared editor attach target (the active row text cell)
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const [editorAttachedEdgeId, setEditorAttachedEdgeId] = useState<EdgeId | null>(null);
  const [pendingCursor, setPendingCursor] = useState<PendingCursorRequest | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement | null>(null);
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
  // Pointer-based drag for rescheduling (bullet is the drag handle)
  interface DragIntent {
    readonly pointerId: number;
    readonly startX: number;
    readonly startY: number;
    readonly anchorEdgeId: EdgeId;
    readonly draggedEdgeIds: readonly EdgeId[];
  }
  interface DropPlan {
    readonly type: "day" | "section";
    readonly isoDay?: string;
    readonly section?: "Today" | "NextSevenDays" | "Later";
    readonly key: string;
  }
  const DRAG_THRESHOLD_PX = 4;
  const dragIntentRef = useRef<DragIntent | null>(null);
  const [dragIntent, setDragIntent] = useState<DragIntent | null>(null);
  const [activeDrag, setActiveDrag] = useState<{ pointerId: number; plan: DropPlan | null } | null>(null);

  const findDropTargetPlan = useCallback((clientX: number, clientY: number): DropPlan | null => {
    if (typeof document === "undefined") {
      return null;
    }
    const element = document.elementFromPoint(clientX, clientY);
    if (!element) {
      return null;
    }
    const sectionEl = element.closest<HTMLElement>('[data-tasks-drop-target="section"]');
    if (sectionEl) {
      const value = sectionEl.getAttribute("data-section") as "Today" | "NextSevenDays" | "Later" | null;
      if (value && (value === "Today" || value === "NextSevenDays" || value === "Later")) {
        const key = sectionEl.getAttribute("data-key") ?? `section:${value}`;
        return { type: "section", section: value, key };
      }
      return null;
    }
    const dayEl = element.closest<HTMLElement>('[data-tasks-drop-target="day"]');
    if (dayEl) {
      const isoDay = dayEl.getAttribute("data-iso-day");
      const key = dayEl.getAttribute("data-key") ?? (isoDay ? `day:${isoDay}` : "");
      if (isoDay && key) {
        return { type: "day", isoDay, key };
      }
    }
    return null;
  }, []);

  useEffect(() => {
    if (!activeDrag && !dragIntent) {
      return;
    }
    const handlePointerMove = (event: PointerEvent) => {
      const intent = dragIntentRef.current;
      if (intent && event.pointerId === intent.pointerId) {
        const dx = Math.abs(event.clientX - intent.startX);
        const dy = Math.abs(event.clientY - intent.startY);
        if (dx >= DRAG_THRESHOLD_PX || dy >= DRAG_THRESHOLD_PX) {
          const plan = findDropTargetPlan(event.clientX, event.clientY);
          setActiveDrag({ pointerId: intent.pointerId, plan });
          setDropTargetKey(plan ? plan.key : null);
        }
        return;
      }
      const active = activeDrag;
      if (active && event.pointerId === active.pointerId) {
        const plan = findDropTargetPlan(event.clientX, event.clientY);
        setActiveDrag((prev) => (prev && prev.pointerId === event.pointerId ? { pointerId: prev.pointerId, plan } : prev));
        setDropTargetKey(plan ? plan.key : null);
      }
    };
    const finalize = (event: PointerEvent, apply: boolean) => {
      const intent = dragIntentRef.current;
      const active = activeDrag;
      if (intent && event.pointerId === intent.pointerId) {
        const plan = (active && active.pointerId === event.pointerId) ? active.plan : null;
        if (apply && plan) {
          const edges = intent.draggedEdgeIds;
          if (plan.type === "day" && plan.isoDay) {
            handleDropReschedule(edges, { type: "day", isoDay: plan.isoDay });
          } else if (plan.type === "section" && plan.section) {
            handleDropReschedule(edges, { type: "section", section: plan.section });
          }
        }
        dragIntentRef.current = null;
        setDragIntent(null);
        setActiveDrag(null);
        setDropTargetKey(null);
        return;
      }
      if (active && event.pointerId === active.pointerId) {
        setActiveDrag(null);
        setDropTargetKey(null);
      }
    };
    const handlePointerUp = (e: PointerEvent) => finalize(e, true);
    const handlePointerCancel = (e: PointerEvent) => finalize(e, false);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [activeDrag, dragIntent, findDropTargetPlan, handleDropReschedule]);

  const isEditorEventTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Node)) {
      return false;
    }
    const element = target instanceof HTMLElement ? target : target.parentElement;
    return Boolean(element?.closest(".thortiq-prosemirror"));
  };

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

  // Drag selection across task rows only
  const dragSelection = useRowDragSelection({
    elementFromPoint: (x, y) => (typeof document !== "undefined" ? document.elementFromPoint(x, y) : null),
    edgeIndexMap: new Map(taskRowEdgeIds.map((id, index) => [id as EdgeId, index])),
    isSelectable: (edgeId) => taskRowEdgeIds.includes(edgeId as string),
    setSelectionRange: (range) => setSelectionRange(range),
    setSelectedEdgeId: (edgeId, options) => setSelectedEdgeId(edgeId as EdgeId, options)
  });

  // Inline date picker handling with multi-apply semantics (local orchestration)
  const [datePickerState, setDatePickerState] = useState<{
    edgeId: EdgeId;
    nodeId: NodeId;
    value: string | null;
    hasTime: boolean;
    anchor: { left: number; top: number; bottom: number };
  } | null>(null);
  const handleOpenDatePicker = useCallback((payload: { edgeId: EdgeId; nodeId: NodeId; value: string | null; hasTime: boolean; anchor: { left: number; top: number; bottom: number } }) => {
    setDatePickerState(payload);
  }, []);
  const handleApplyDate = useCallback((date: Date) => {
    const state = datePickerState;
    if (!state) return;
    const selected = selectionAdapter.getOrderedEdgeIds();
    const isEdgeSelected = selected.includes(state.edgeId);
    if (isEdgeSelected && selected.length > 1) {
      const nodeIds = selected.map((e) => getEdgeSnapshot(outline, e as EdgeId).childNodeId);
      setTasksDueDate(outline, nodeIds, date, localOrigin);
    } else {
      setSelectionRange(null);
      setSelectedEdgeId(state.edgeId as EdgeId);
      setTaskDueDate(outline, state.nodeId, date, localOrigin);
    }
    setDatePickerState(null);
  }, [datePickerState, localOrigin, outline, selectionAdapter, setSelectionRange, setSelectedEdgeId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, fontFamily: FONT_FAMILY_STACK, ...style }}>
      <div style={{ ...PANE_HEADER_BASE_STYLE, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.25rem 0.5rem", gap: "0.5rem", font: "inherit", ...(activePaneId === paneId ? PANE_HEADER_ACTIVE_STYLE : undefined) }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {paneSearch.isInputVisible ? (
            <PaneSearchBar controller={paneSearch} placeholder="Search tasks…" ariaLabel="Search tasks" />
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", ...(paneSearch.isInputVisible ? { marginBottom: "0.5rem" } : {}) }}>
          <PaneHeaderActions
            isSearchVisible={paneSearch.isInputVisible}
            onToggleSearch={() => {
              if (paneSearch.isInputVisible) {
                paneSearch.clearResults();
                paneSearch.hideInput();
              } else {
                paneSearch.setInputVisible(true);
              }
            }}
            searchButtonAriaLabel="Search tasks"
            searchButtonTitle="Search"
            rightContent={null}
          />
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setTasksPaneShowCompleted(outline, e.target.checked, localOrigin)}
              aria-label="Show completed tasks"
              title="Show completed tasks"
            />
          </label>
            <button
            type="button"
            onClick={() => {
              sessionStore.update((state) => {
                const result = closePane(state, paneId);
                return result.didClose ? result.state : state;
              });
            }}
            aria-label="Close pane"
            title="Close pane"
            style={{
              border: "none",
              backgroundColor: "transparent",
              padding: 0,
              width: "1.75rem",
              height: "1.75rem",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "9999px",
              outline: "none",
              transition: "background-color 120ms ease, color 120ms ease",
              color: "#6b7280",
              cursor: "pointer"
            }}
          >
            <svg focusable="false" viewBox="0 0 24 24" style={{ width: "1.1rem", height: "1.1rem" }} aria-hidden="true">
              <path d="M6 6 18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M18 6 6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }} ref={parentRef}>
        {rows.map((row) => {
          if (row.kind === "sectionHeader") {
            const isCollapsed = collapsedSections.has(row.section);
            return (
              <div
                key={row.key}
                role="button"
                tabIndex={0}
                style={{ fontWeight: 600, padding: "0.5rem 0.25rem", background: dropTargetKey === row.key ? "#e0f2fe" : undefined, userSelect: "none", display: "flex", alignItems: "center", gap: "0.25rem", font: "inherit" }}
                onClick={() => toggleSection(row.section)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSection(row.section); }
                }}
                data-tasks-drop-target="section"
                data-section={row.section}
                data-key={row.key}
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
                    if (row.section === "Undated") {
                      // Clear due dates for dropped tasks
                      try {
                        const nodeIds = edges.map((eId) => getEdgeSnapshot(outline, eId as EdgeId).childNodeId);
                        if (nodeIds.length === 1) {
                          clearTaskDueDate(outline, nodeIds[0], localOrigin);
                        } else if (nodeIds.length > 1) {
                          clearTasksDueDate(outline, nodeIds, localOrigin);
                        }
                      } catch (_err) { /* ignore */ }
                    } else {
                      const section = row.section === "Today" ? "Today" : row.section === "NextSevenDays" ? "NextSevenDays" : row.section === "Later" ? "Later" : null;
                      if (section) {
                        handleDropReschedule(edges, { type: "section", section });
                      }
                    }
                  }
                }}
              >
                <span style={{ display: "inline-flex", width: "0.9rem", height: "0.9rem", transition: "transform 120ms ease" }}>
                  <svg viewBox="0 0 24 24" style={{ display: "inline", width: "100%", height: "100%", transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)", fill: "#6b7280" }} aria-hidden="true" focusable="false">
                    <path d="M8 5l8 7-8 7z" />
                  </svg>
                </span>
                <h3 style={{
                  margin: 0,
                  font: "inherit",
                  color: row.section === "Overdue" ? "#dc2626" :
                    row.section === "Today" ? "#16a34a" :
                    row.section === "NextSevenDays" ? "#d97706" :
                    row.section === "Later" ? "#2563eb" : "#6b7280"
                }}>
                  {row.section === "Overdue" ? "Overdue" :
                   row.section === "Today" ? "Today" :
                   row.section === "NextSevenDays" ? "Next seven days" :
                   row.section === "Later" ? "Later" : "Undated"}
                </h3>
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
                style={{ padding: "0.25rem 0.25rem", color: "#6b7280", background: dropTargetKey === row.key ? "#e0f2fe" : undefined, userSelect: "none", display: "flex", alignItems: "center", gap: "0.25rem", paddingLeft: "1.1rem", font: "inherit" }}
                onClick={() => toggleDay(row.key)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleDay(row.key); } }}
                data-tasks-drop-target="day"
                data-iso-day={(() => { const parts = row.key.split(":"); return parts[2] ?? ""; })()}
                data-key={row.key}
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
                <span style={{ display: "inline-flex", width: "0.9rem", height: "0.9rem", transition: "transform 120ms ease" }}>
                  <svg viewBox="0 0 24 24" style={{ display: "inline", width: "100%", height: "100%", transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)", fill: "#6b7280" }} aria-hidden="true" focusable="false">
                    <path d="M8 5l8 7-8 7z" />
                  </svg>
                </span>
                {row.label}
              </div>
            );
          }
          // selection tracked via selectedEdgeId comparisons in OutlineRowView props
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
          // Determine if this task is within a day group to compute base indent
          let isInDayGroup = false;
          for (let i = rows.indexOf(row) - 1; i >= 0; i -= 1) {
            const prev = rows[i];
            if (prev.kind === "dayHeader") {
              isInDayGroup = true;
              break;
            }
            if (prev.kind === "sectionHeader") {
              break;
            }
          }
          // Header geometry: keep caret sizes aligned with Outline header glyph sizing
          const HEADER_CARET_REM = 0.9; // caret wrapper width used in headers
          const HEADER_GAP_REM = 0.25; // gap between caret and header text
          const DAY_PADDING_LEFT_REM = 1.1; // left padding applied to day headers
          const baseIndentRem = isInDayGroup
            ? DAY_PADDING_LEFT_REM + HEADER_CARET_REM + HEADER_GAP_REM
            : HEADER_CARET_REM + HEADER_GAP_REM;

          // Reuse Outline row rendering for tasks
          const outlineRow = toOutlineRow(row.edgeId as EdgeId, 0, []);
          const handleToggleCollapsed = (edgeId: EdgeId, collapsed?: boolean) => {
            const nextExpanded = collapsed === undefined ? !isTaskExpanded(edgeId) : !collapsed;
            setTaskExpanded(edgeId, nextExpanded);
          };
          const handleSelect = (edgeId: EdgeId) => {
            // Select the edge; editor attachment is driven by onActiveTextCellChange
            // once the text cell element is available to host the editor.
            handleSelectEdge(edgeId);
          };
          const handleRowMouseDown = (event: React.MouseEvent<HTMLDivElement>, edgeId: EdgeId) => {
            const button = event.button ?? 0;
            if (button !== 0) {
              return;
            }
            if (isEditorEventTarget(event.target)) {
              return;
            }
            event.preventDefault();
            const { clientX, clientY } = event;
            let next: PendingCursorRequest = { placement: "coords", clientX, clientY };
            const target = event.target as HTMLElement | null;
            const textCell = target?.closest('[data-outline-text-cell="true"]') ?? null;
            const textContent = target?.closest('[data-outline-text-content="true"]') ?? null;
            if (textCell && !textContent) {
              const contentElement = textCell.querySelector<HTMLElement>('[data-outline-text-content="true"]');
              if (contentElement) {
                const { right } = contentElement.getBoundingClientRect();
                if (clientX >= right) {
                  next = { placement: "text-end" };
                }
              }
            }
            setPendingCursor(next);
            handleSelect(edgeId);
          };
          const onBulletActivate: NonNullable<Parameters<typeof OutlineRowView>[0]["onBulletActivate"]> = ({ edgeId, event }) => {
            const paneIds = sessionStore.getState().paneOrder;
            const selfIndex = paneIds.indexOf(paneId);
            const leftNeighborId = selfIndex > 0 ? paneIds[selfIndex - 1] : null;
            const openLeft = () => {
              const current = sessionStore.getState();
              const { state: next } = openPaneRightOf(current, paneId, { paneKind: "outline", focusEdgeId: edgeId });
              sessionStore.setState(next);
            };
            event.preventDefault();
            event.stopPropagation();
            if (event.shiftKey) {
              if (leftNeighborId) {
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
            <div key={row.key} style={{ display: "flex", flexDirection: "column", paddingLeft: `${baseIndentRem}rem` }}>
              {outlineNodes.map((orow) => {
                const view = (
                  <OutlineRowView
                    key={orow.edgeId}
                    row={orow}
                    isSelected={selectedEdgeId === orow.edgeId}
                    isPrimarySelected={selectedEdgeId === orow.edgeId}
                    onFocusEdge={undefined}
                    highlightSelected={false}
                    editorAttachedEdgeId={editorAttachedEdgeId}
                    isActivePane={isActivePane}
                    onSelect={handleSelect}
                    onToggleCollapsed={handleToggleCollapsed}
                    onToggleTodo={(edgeId) => {
                      toggleTodoDoneCommand({ outline, origin: localOrigin }, [edgeId]);
                    }}
                    editorEnabled={true}
                    presence={[]}
                    onRowPointerDownCapture={(event) => {
                      // Ignore clicks on non-task rows (shouldn't happen here) and let selection hook start drag
                      dragSelection.onRowPointerDownCapture(event as unknown as React.PointerEvent<HTMLDivElement>, orow.edgeId as EdgeId);
                    }}
                    onDragHandlePointerDown={(event) => {
                      if (!event.isPrimary || event.button !== 0) {
                        return;
                      }
                      const edges = computeDraggedEdgeIds(orow.edgeId);
                      const intent = {
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startY: event.clientY,
                        anchorEdgeId: orow.edgeId as EdgeId,
                        draggedEdgeIds: edges as EdgeId[]
                      } satisfies DragIntent;
                      dragIntentRef.current = intent;
                      setDragIntent(intent);
                      setActiveDrag(null);
                      // Also populate native DnD payload for header drops via standard HTML5 DnD
                      try {
                        const element = event.currentTarget as HTMLElement;
                        const rowEl = element.closest('[data-outline-row="true"]') as HTMLElement | null;
                        if (rowEl) {
                          rowEl.setAttribute('draggable', 'true');
                          const handleDragStart = (de: DragEvent) => {
                            try {
                              de.dataTransfer?.setData('application/x-thortiq-task-edges', JSON.stringify(edges));
                            } catch (_err) {
                              void 0;
                            }
                          };
                          const handleDragEnd = () => {
                            rowEl.removeAttribute('draggable');
                            rowEl.removeEventListener('dragstart', handleDragStart);
                            rowEl.removeEventListener('dragend', handleDragEnd);
                          };
                          rowEl.addEventListener('dragstart', handleDragStart, { once: false });
                          rowEl.addEventListener('dragend', handleDragEnd, { once: true });
                        }
                      } catch (_err) {
                        void 0;
                      }
                    }}
                    onRowMouseDown={handleRowMouseDown}
                    onDateClick={({ edgeId, sourceNodeId, anchor, value, displayText, hasTime, segmentIndex, position }) => {
                      void displayText; void segmentIndex; void position;
                      handleOpenDatePicker({ edgeId: edgeId as EdgeId, nodeId: sourceNodeId as NodeId, value, hasTime, anchor });
                    }}
                    onActiveTextCellChange={(edgeId, element) => {
                      // Mirror OutlineView behavior: attach only when the selected row's
                      // text cell element is available; clear when it goes away.
                      if (!element) {
                        if (editorAttachedEdgeId === edgeId) {
                          editorContainerRef.current = null;
                          setEditorAttachedEdgeId(null);
                        }
                        return;
                      }
                      if (selectedEdgeId === edgeId) {
                        editorContainerRef.current = element;
                        setEditorAttachedEdgeId(edgeId);
                      }
                    }}
                    onBulletActivate={onBulletActivate}
                  />
                );
                return (
                  <div key={`wrap-${orow.edgeId}`}>
                    {view}
                  </div>
                );
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
          pendingCursor={pendingCursor}
          onPendingCursorHandled={() => setPendingCursor(null)}
          selectionAdapter={selectionAdapter}
          paneMode="tasks"
          onEditorInstanceChange={(editor) => {
            try {
              const dom = (editor as unknown as { view?: { dom?: HTMLElement } } | null | undefined)?.view?.dom;
              if (dom) {
                const onFocusIn = () => setIsEditorFocused(true);
                const onFocusOut = () => {
                  setIsEditorFocused(false);
                  setRows(buildTaskPaneRows(snapshot as OutlineSnapshot, { showCompleted, includeEmptyNextSevenDaysDays: true }).rows);
                  dom.removeEventListener("focusin", onFocusIn);
                  dom.removeEventListener("focusout", onFocusOut);
                };
                dom.addEventListener("focusin", onFocusIn);
                dom.addEventListener("focusout", onFocusOut, { once: true });
              }
            } catch { /* noop */ }
          }}
          onDateClick={({ edgeId, sourceNodeId, anchor, value, hasTime, displayText, segmentIndex, position }) => {
            void displayText; void segmentIndex; void position;
            handleOpenDatePicker({ edgeId: edgeId as EdgeId, nodeId: sourceNodeId as NodeId, value, hasTime, anchor });
          }}
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
      {datePickerState ? (
        <DatePickerPopover
          anchor={datePickerState.anchor}
          value={datePickerState.value ? new Date(datePickerState.value) : null}
          onSelect={handleApplyDate}
          onClose={() => setDatePickerState(null)}
        />
      ) : null}
    </div>
  );
};

export default TasksPaneView;


