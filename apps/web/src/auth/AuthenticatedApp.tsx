/**
 * Authenticated application shell providing a resizable navigation pane with profile controls.
 * The layout replaces the previous header + device list so the outline view remains the focus
 * while account management lives inside a lightweight dialog triggered from the left rail.
 */
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AuthErrorNotice,
  PaneManager,
  type PaneRendererProps,
  useAuthActions,
  useAuthRememberDevicePreference,
  useAuthSession
} from "@thortiq/client-react";
import { getUserSetting, setUserSetting } from "@thortiq/client-core/preferences";
import { focusPane, openPaneRightOf } from "@thortiq/client-core";
// import { EDGE_CHILD_NODE_KEY } from "@thortiq/client-core/doc";

import type { SyncManagerStatus } from "../outline/OutlineProvider";
import { OutlineProvider, useSyncStatus, useSyncContext } from "../outline/OutlineProvider";
import { DatePickerPopover } from "@thortiq/client-react";
import { getJournalNodeId } from "@thortiq/client-core";
import { ensureJournalEntry, ensureFirstChild } from "@thortiq/client-core";
import { getParentEdgeId, getEdgeSnapshot, getChildEdgeIds } from "@thortiq/client-core";
// import * as Y from "yjs";
import { useOutlineActivePaneId, useOutlineSessionStore, useOutlinePaneState } from "@thortiq/client-react";
import { OutlineView } from "../outline/OutlineView";
import TasksPaneView from "../outline/TasksPaneView";
import type { Virtualizer } from "@tanstack/react-virtual";
import { MissingNodeDialog } from "../outline/components/MissingNodeDialog";
import { useShellLayoutState } from "./useShellLayoutState";

const PANE_MIN_WIDTH = 100;
const PANE_MAX_WIDTH = 440;
const PANE_COLLAPSED_WIDTH = 40;
const PANE_DEFAULT_WIDTH = 272;
const PROFILE_IMAGE_STORAGE_PREFIX = "thortiq/profile-image/";
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB guardrail for in-memory previews

export const AuthenticatedApp = () => {
  const session = useAuthSession();
  const { logout, logoutEverywhere, updateRememberDevice } = useAuthActions();
  const rememberDevice = useAuthRememberDevicePreference();

  // NOTE: We DO NOT clear IndexedDB on logout to support offline-first/local-first architecture.
  // Users should be able to:
  // 1. Log in and sync their data to IndexedDB
  // 2. Log out
  // 3. Log back in (even offline) and access their local data
  // 4. Sync when connection returns
  //
  // IndexedDB is already scoped by userId (thortiq::<userId>::sync::outline:<docId>)
  // so different users won't conflict. Only clear caches when explicitly requested
  // (e.g., "Clear all data" action) or when switching users.

  if (!session) {
    return null;
  }

  return (
    <OutlineProvider options={{ userId: session.user.id, syncToken: session.syncToken ?? null, autoConnect: true }}>
      <AuthenticatedShell
        session={session}
        rememberDevice={rememberDevice}
        updateRememberDevice={updateRememberDevice}
        logout={logout}
        logoutEverywhere={logoutEverywhere}
      />
    </OutlineProvider>
  );
};

type AuthenticatedSession = NonNullable<ReturnType<typeof useAuthSession>>;

interface AuthenticatedShellProps {
  readonly session: AuthenticatedSession;
  readonly rememberDevice: boolean;
  readonly updateRememberDevice: (remember: boolean) => Promise<void>;
  readonly logout: () => Promise<void>;
  readonly logoutEverywhere: () => Promise<void>;
}

const AuthenticatedShell = ({
  session,
  rememberDevice,
  updateRememberDevice,
  logout,
  logoutEverywhere
}: AuthenticatedShellProps) => {
  const shellLayoutBounds = useMemo(
    () => ({
      minWidth: PANE_MIN_WIDTH,
      maxWidth: PANE_MAX_WIDTH,
      collapsedWidth: PANE_COLLAPSED_WIDTH,
      defaultWidth: PANE_DEFAULT_WIDTH
    }),
    []
  );

  const {
    paneWidth,
    isCollapsed,
    setPaneWidth,
    setIsCollapsed,
    persist: persistLayout
  } = useShellLayoutState(session.user.id, shellLayoutBounds);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const paneHandleRef = useRef<HTMLDivElement | null>(null);
  const avatarButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isProfileDialogOpen, setProfileDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const syncStatus = useSyncStatus();
  const [profileImage, setProfileImage] = useProfileImage(session.user.id);
  const initials = useMemo(() => createInitials(session.user.displayName || session.user.email), [
    session.user.displayName,
    session.user.email
  ]);
  const statusIndicator = useMemo(() => createStatusIndicator(syncStatus), [syncStatus]);
  const RenderPane = ({ paneId, layout, onVirtualizerChange }: { paneId: string; layout: "horizontal" | "stacked"; onVirtualizerChange?: (v: Virtualizer<HTMLDivElement, Element> | null) => void }) => {
    const pane = useOutlinePaneState(paneId);
    const style = layout === "stacked" ? { marginBottom: "1.5rem" } : undefined;
    if (pane && pane.paneKind === "tasks") {
      return <TasksPaneView paneId={paneId} style={style} />;
    }
    return (
      <OutlineView
        paneId={paneId}
        variant="embedded"
        onVirtualizerChange={onVirtualizerChange}
        style={style}
      />
    );
  };

  const renderPane = useCallback(
    (paneId: string, { layout, onVirtualizerChange }: PaneRendererProps) => (
      <RenderPane paneId={paneId} layout={layout} onVirtualizerChange={onVirtualizerChange} />
    ),
    []
  );
  const visibleName = session.user.displayName || session.user.email;

  // Journal UI state
  const journalButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isJournalPickerOpen, setJournalPickerOpen] = useState(false);
  const [journalPickerAnchor, setJournalPickerAnchor] = useState<{ left: number; top: number; bottom: number } | null>(null);
  const [isMissingJournalDialogOpen, setMissingJournalDialogOpen] = useState(false);
  const { outline, localOrigin } = useSyncContext();
  const sessionStore = useOutlineSessionStore();
  const activePaneId = useOutlineActivePaneId();

  const openJournalPicker = useCallback(() => {
    if (!journalButtonRef.current) {
      return;
    }
    const rect = journalButtonRef.current.getBoundingClientRect();
    setJournalPickerAnchor({ left: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom });
    setJournalPickerOpen(true);
  }, []);

  const openTasksPane = useCallback(() => {
    const current = sessionStore.getState();
    const order = current.paneOrder;
    const referencePaneId = order.length > 0 ? order[order.length - 1] : current.activePaneId;
    const { state: next } = openPaneRightOf(current, referencePaneId, { paneKind: "tasks" });
    sessionStore.setState(next);
  }, [sessionStore]);

  const closeJournalPicker = useCallback(() => {
    setJournalPickerOpen(false);
    setJournalPickerAnchor(null);
  }, []);

  const goToJournalDate = useCallback((date: Date) => {
    const journalNodeId = getJournalNodeId(outline);
    if (!journalNodeId) {
      // Show missing journal dialog
      setMissingJournalDialogOpen(true);
      return;
    }
    // Format display text using user setting from OutlineView's format function is not directly accessible here;
    // fallback to a short default display (weekday short, month short, day numeric) to build the pill.
    const formatter = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric"
    });
    const displayText = formatter.format(date);
    const { entryNodeId } = ensureJournalEntry(outline, journalNodeId, date, displayText, localOrigin);
    // Ensure the entry has a first child; focus caret at start of that child later
    ensureFirstChild(outline, entryNodeId, localOrigin);

    // Resolve the edge id for the entry node
    const entryEdgeId = getParentEdgeId(outline, entryNodeId);
    if (!entryEdgeId) {
      return;
    }

    // Build path edge ids from root to the entry edge
    const computePathToEdge = (edgeId: string): readonly string[] => {
      const path: string[] = [];
      let currentEdgeId: string | null = edgeId;
      const visited = new Set<string>();
      while (currentEdgeId) {
        if (visited.has(currentEdgeId)) break;
        visited.add(currentEdgeId);
        path.push(currentEdgeId);
        const snap = getEdgeSnapshot(outline, currentEdgeId as unknown as string);
        const parentNodeId = snap.parentNodeId;
        if (parentNodeId === null) {
          break;
        }
        const parentEdge = getParentEdgeId(outline, parentNodeId);
        currentEdgeId = parentEdge ?? null;
      }
      return path.reverse();
    };

    const pathEdgeIds = computePathToEdge(entryEdgeId);
    // Ensure caret targets the first child when available; otherwise fall back to the entry itself
    const childEdges = getChildEdgeIds(outline, entryNodeId);
    const firstChildEdgeId = childEdges.length > 0 ? childEdges[0] : null;

    sessionStore.update((state) => {
      const targetEdgeId = (firstChildEdgeId ?? pathEdgeIds[pathEdgeIds.length - 1]) as string;
      const result = focusPane(state, activePaneId, {
        edgeId: pathEdgeIds[pathEdgeIds.length - 1] as string,
        focusPathEdgeIds: pathEdgeIds,
        makeActive: true,
        pendingFocusEdgeId: targetEdgeId
      });
      return result.state;
    });
  }, [activePaneId, localOrigin, outline, sessionStore]);

  // Journal Today shortcut integration: react to OutlineView-dispatched custom event to avoid browser Alt+D default
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onJournalToday = () => {
      goToJournalDate(new Date());
    };
    window.addEventListener("thortiq:journal-today", onJournalToday as EventListener);
    return () => window.removeEventListener("thortiq:journal-today", onJournalToday as EventListener);
  }, [goToJournalDate]);

  // Global Alt+D suppression: capture and prevent the browser address bar shortcut reliably
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handler = (event: KeyboardEvent) => {
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (!event.altKey || key !== "d") {
        return;
      }
      // Aggressively block default and propagation
      event.preventDefault();
      event.stopPropagation();
      // Some browsers respect stopImmediatePropagation on native listeners
      const nativeEvent = event as KeyboardEvent & { stopImmediatePropagation?: () => void; returnValue?: boolean };
      if (typeof nativeEvent.stopImmediatePropagation === "function") {
        nativeEvent.stopImmediatePropagation();
      }
      if ("returnValue" in nativeEvent) {
        nativeEvent.returnValue = false;
      }
      goToJournalDate(new Date());
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, true);
  }, [goToJournalDate]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragState.current) {
        return;
      }
      const delta = event.clientX - dragState.current.startX;
      const nextWidth = dragState.current.startWidth + delta;
      setPaneWidth(nextWidth, { updateLastExpanded: true });
    };
    
    const handlePointerUp = () => {
      dragState.current = null;
      persistLayout();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target !== paneHandleRef.current) {
        return;
      }
      dragState.current = { startX: event.clientX, startWidth: paneWidth };
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      event.preventDefault();
    };
    
    const handle = paneHandleRef.current;
    if (handle) {
      handle.addEventListener("pointerdown", handlePointerDown);
    }
    
    return () => {
      if (handle) {
        handle.removeEventListener("pointerdown", handlePointerDown);
      }
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isCollapsed, paneWidth, persistLayout, setPaneWidth]); // Re-run when collapsed state or pane width changes

  const handleRememberDeviceChange = useCallback(
    async (nextValue: boolean) => {
      try {
        await updateRememberDevice(nextValue);
      } catch (error) {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          console.warn("Failed to update remember device preference", error);
        }
      }
    },
    [updateRememberDevice]
  );

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch (error) {
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("Failed to log out", error);
      }
    }
  }, [logout]);

  const handleLogoutEverywhere = useCallback(async () => {
    try {
      await logoutEverywhere();
    } catch (error) {
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("Failed to log out everywhere", error);
      }
    }
  }, [logoutEverywhere]);

  const handleToggleCollapse = useCallback(() => {
    if (isCollapsed) {
      setIsCollapsed(false, { persist: true });
    } else {
      setIsCollapsed(true, { persist: true });
    }
  }, [isCollapsed, setIsCollapsed]);

  return (
    <>
      <div style={{ display: "flex", height: "100vh", minHeight: 0, width: "100%", overflow: "hidden" }}>
        <aside
          style={{
            width: `${paneWidth}px`,
            borderRight: "1px solid #e5e7eb",
            background: "#f9fafb",
            display: "flex",
            flexDirection: "column",
            padding: isCollapsed ? "0.5rem 0" : "1rem",
            position: "relative",
            minHeight: 0,
            overflowY: "auto"
          }}
        >
          {/* Collapse/Expand button */}
          <button
            type="button"
            onClick={handleToggleCollapse}
            style={{
              position: "absolute",
              top: "0.5rem",
              right: "0.5rem",
              marginBottom: "15px",
              width: "24px",
              height: "24px",
              borderRadius: "6px",
              border: "none",
              background: "rgba(255, 255, 255, 0.8)",
              backdropFilter: "blur(4px)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
              color: "#6b7280",
              zIndex: 10,
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
              transition: "all 0.2s ease"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.95)";
              e.currentTarget.style.color = "#374151";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.8)";
              e.currentTarget.style.color = "#6b7280";
            }}
            aria-label={isCollapsed ? "Expand panel" : "Collapse panel"}
          >
            {isCollapsed ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            )}
          </button>

          {isCollapsed ? (
            // Collapsed state
            <>
              {/* Journal icon for collapsed state (near top under toggle) */}
              <div style={{ display: "flex", justifyContent: "center", marginTop: "2rem", paddingBottom: "0.75rem" }}>
                <button
                  ref={journalButtonRef}
                  type="button"
                  onClick={openJournalPicker}
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "6px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#6b7280",
                    transition: "all 0.2s ease"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.05)";
                    e.currentTarget.style.color = "#374151";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                    e.currentTarget.style.color = "#6b7280";
                  }}
                  aria-label="Open Journal"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                </button>
              </div>
              {/* Tasks icon for collapsed state */}
              <div style={{ display: "flex", justifyContent: "center", paddingBottom: "0.75rem" }}>
                <button
                  type="button"
                  onClick={openTasksPane}
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "6px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#6b7280",
                    transition: "all 0.2s ease"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.05)";
                    e.currentTarget.style.color = "#374151";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                    e.currentTarget.style.color = "#6b7280";
                  }}
                  aria-label="Open Tasks Pane"
                >
                  {/* Task icon: checkbox */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <polyline points="9 12 11 14 15 10"/>
                  </svg>
                </button>
              </div>
              
              {/* Spacer to push the remaining items to the bottom */}
              <div style={{ flex: 1 }} />
              
              {/* Settings icon for collapsed state */}
              <div style={{ display: "flex", justifyContent: "center", paddingBottom: "0.75rem" }}>
                <button
                  type="button"
                  onClick={() => setSettingsDialogOpen(true)}
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "6px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#6b7280",
                    transition: "all 0.2s ease"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.05)";
                    e.currentTarget.style.color = "#374151";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                    e.currentTarget.style.color = "#6b7280";
                  }}
                  aria-label="Open settings"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
                </button>
              </div>
              
              {/* Connection status for collapsed state */}
              <div style={{ display: "flex", justifyContent: "center", paddingBottom: "0.75rem" }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "9999px",
                    backgroundColor: statusIndicator.color,
                    display: "inline-block",
                    boxShadow: "inset 0 0 0 1px rgba(15, 23, 42, 0.1)"
                  }}
                />
              </div>
            </>
          ) : (
            // Expanded state
            <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <button
              ref={avatarButtonRef}
              type="button"
              onClick={() => setProfileDialogOpen(true)}
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "9999px",
                border: "2px solid #e5e7eb",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#fff",
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)"
              }}
              aria-label="Open profile"
            >
              {profileImage ? (
                <img
                  src={profileImage}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span style={{ fontSize: "1.25rem", fontWeight: 600, color: "#4b5563" }}>{initials}</span>
              )}
            </button>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <button
                type="button"
                onClick={() => setProfileDialogOpen(true)}
                style={{
                  marginTop: "0.25rem",
                  padding: "0.25rem 0",
                  background: "transparent",
                  border: "none",
                  color: "#4f46e5",
                  fontSize: "0.875rem",
                  textAlign: "left",
                  cursor: "pointer"
                }}
              >
                View profile
              </button>
            </div>
          </div>
          
          {/* Journal button */}
          <div style={{ marginTop: "1rem", marginBottom: "1rem" }}>
            <button
              ref={journalButtonRef}
              type="button"
              onClick={openJournalPicker}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem",
                background: "transparent",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                color: "#4b5563",
                fontSize: "0.875rem",
                width: "100%",
                transition: "background-color 0.2s ease"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.05)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
              aria-label="Open Journal"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              <span>Journal</span>
            </button>
          </div>
          {/* Tasks button */}
          <div style={{ marginBottom: "0.5rem" }}>
            <button
              type="button"
              onClick={openTasksPane}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem",
                background: "transparent",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                color: "#4b5563",
                fontSize: "0.875rem",
                width: "100%",
                transition: "background-color 0.2s ease"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.05)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
              aria-label="Open Tasks Pane"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <polyline points="9 12 11 14 15 10"/>
              </svg>
              <span>Tasks</span>
            </button>
          </div>
          <div style={{ flex: 1 }} />
          
          {/* Settings button */}
          <div style={{ marginBottom: "1rem" }}>
            <button
              type="button"
              onClick={() => setSettingsDialogOpen(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem",
                background: "transparent",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                color: "#4b5563",
                fontSize: "0.875rem",
                width: "100%",
                transition: "background-color 0.2s ease"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.05)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
              aria-label="Open settings"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              <span>Settings</span>
            </button>
          </div>
          
          <StatusFooter indicator={statusIndicator} />
            </>
          )}
        </aside>
        {!isCollapsed && (
          <div
            ref={paneHandleRef}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize side panel"
            tabIndex={0}
            style={{
              width: "8px",
              cursor: "col-resize",
              background: "transparent",
              position: "relative"
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                const newWidth = Math.max(PANE_MIN_WIDTH, paneWidth - 16);
                setPaneWidth(newWidth, { updateLastExpanded: true, persist: true });
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                const newWidth = Math.min(PANE_MAX_WIDTH, paneWidth + 16);
                setPaneWidth(newWidth, { updateLastExpanded: true, persist: true });
              }
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <PaneManager
            style={{ flex: 1, minHeight: 0, padding: "0 0.75rem" }}
            renderPane={renderPane}
          />
        </div>
      </div>
      <ProfileDialog
        isOpen={isProfileDialogOpen}
        onClose={() => {
          setProfileDialogOpen(false);
          if (avatarButtonRef.current) {
            avatarButtonRef.current.focus();
          }
        }}
        userName={visibleName}
        userEmail={session.user.email}
        profileImage={profileImage}
        onProfileImageSelected={setProfileImage}
        rememberDevice={rememberDevice}
        onRememberDeviceChange={handleRememberDeviceChange}
        onLogout={handleLogout}
        onLogoutEverywhere={handleLogoutEverywhere}
      />
      <SettingsDialog
        isOpen={isSettingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
      />
      {isJournalPickerOpen && journalPickerAnchor ? (
        <DatePickerPopover
          anchor={journalPickerAnchor}
          value={null}
          onSelect={(date) => {
            goToJournalDate(date);
            closeJournalPicker();
          }}
          onClose={closeJournalPicker}
        />
      ) : null}
      <MissingNodeDialog
        isOpen={isMissingJournalDialogOpen}
        nodeType="Journal"
        onClose={() => setMissingJournalDialogOpen(false)}
      />
    </>
  );
};

const createStatusIndicator = (status: SyncManagerStatus) => {
  const normalized = status.charAt(0).toUpperCase() + status.slice(1);
  const color = status === "connected" ? "#10b981" : "#9ca3af";
  return { label: normalized, color };
};

interface SettingsDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

const SettingsDialog = ({ isOpen, onClose }: SettingsDialogProps) => {
  const { outline } = useSyncContext();
  
  // Load current settings with defaults
  const currentJournalFormat = (getUserSetting(outline, "journalDateFormat") as string) ?? "YYYY-MM-DD";
  const currentDatePillFormat = (getUserSetting(outline, "datePillFormat") as string) ?? "MMM DD";
  
  const [journalDateFormat, setJournalDateFormat] = useState(currentJournalFormat);
  const [datePillFormat, setDatePillFormat] = useState(currentDatePillFormat);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  // Update local state when settings change
  useEffect(() => {
    setJournalDateFormat(currentJournalFormat);
    setDatePillFormat(currentDatePillFormat);
  }, [currentJournalFormat, currentDatePillFormat]);

  const handleSave = useCallback(() => {
    setUserSetting(outline, "journalDateFormat", journalDateFormat);
    setUserSetting(outline, "datePillFormat", datePillFormat);
    onClose();
  }, [outline, journalDateFormat, datePillFormat, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "12px",
          padding: "2rem",
          width: "90%",
          maxWidth: "500px",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600, color: "#111827" }}>
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "6px",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#6b7280",
              transition: "all 0.2s ease"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.05)";
              e.currentTarget.style.color = "#374151";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "#6b7280";
            }}
            aria-label="Close settings"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Journal Date Format */}
          <div>
            <label
              htmlFor="journal-date-format"
              style={{
                display: "block",
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "#374151",
                marginBottom: "0.5rem"
              }}
            >
              Journal Date Format
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                id="journal-date-format"
                type="text"
                value={journalDateFormat}
                onChange={(e) => setJournalDateFormat(e.target.value)}
                placeholder="YYYY-MM-DD"
                style={{
                  flex: 1,
                  padding: "0.75rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "0.875rem",
                  backgroundColor: "white",
                  color: "#374151"
                }}
              />
              <button
                type="button"
                onClick={() => setIsHelpOpen(true)}
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "6px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#6b7280",
                  transition: "all 0.2s ease"
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.05)";
                  e.currentTarget.style.color = "#374151";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#6b7280";
                }}
                aria-label="Date format help"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                  <path d="M12 17h.01"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Date Pill Format */}
          <div>
            <label
              htmlFor="date-pill-format"
              style={{
                display: "block",
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "#374151",
                marginBottom: "0.5rem"
              }}
            >
              Date Pill Format
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                id="date-pill-format"
                type="text"
                value={datePillFormat}
                onChange={(e) => setDatePillFormat(e.target.value)}
                placeholder="MMM DD"
                style={{
                  flex: 1,
                  padding: "0.75rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "0.875rem",
                  backgroundColor: "white",
                  color: "#374151"
                }}
              />
              <button
                type="button"
                onClick={() => setIsHelpOpen(true)}
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "6px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#6b7280",
                  transition: "all 0.2s ease"
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.05)";
                  e.currentTarget.style.color = "#374151";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#6b7280";
                }}
                aria-label="Date format help"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                  <path d="M12 17h.01"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "2rem" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "0.75rem 1.5rem",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              background: "white",
              color: "#374151",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s ease"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#f9fafb";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "white";
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: "0.75rem 1.5rem",
              border: "none",
              borderRadius: "6px",
              background: "#4f46e5",
              color: "white",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s ease"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#4338ca";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "#4f46e5";
            }}
          >
            Save
          </button>
        </div>
      </div>
      
      {/* Date Format Help Popup */}
      {isHelpOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1001
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsHelpOpen(false);
            }
          }}
        >
          <div
            style={{
              backgroundColor: "white",
              borderRadius: "12px",
              padding: "2rem",
              width: "90%",
              maxWidth: "600px",
              maxHeight: "80vh",
              overflow: "auto",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "#111827" }}>
                Date Format Help
              </h3>
              <button
                type="button"
                onClick={() => setIsHelpOpen(false)}
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "6px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#6b7280",
                  transition: "all 0.2s ease"
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.05)";
                  e.currentTarget.style.color = "#374151";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#6b7280";
                }}
                aria-label="Close help"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div>
                <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "1rem", fontWeight: 600, color: "#374151" }}>
                  Year Formats
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.875rem" }}>
                  <div style={{ padding: "0.5rem", backgroundColor: "#f9fafb", borderRadius: "4px" }}>
                    <code style={{ fontWeight: 600 }}>YYYY</code> - 2024
                  </div>
                  <div style={{ padding: "0.5rem", backgroundColor: "#f9fafb", borderRadius: "4px" }}>
                    <code style={{ fontWeight: 600 }}>YY</code> - 24
                  </div>
                </div>
              </div>

              <div>
                <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "1rem", fontWeight: 600, color: "#374151" }}>
                  Month Formats
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.875rem" }}>
                  <div style={{ padding: "0.5rem", backgroundColor: "#f9fafb", borderRadius: "4px" }}>
                    <code style={{ fontWeight: 600 }}>MM</code> - 01
                  </div>
                  <div style={{ padding: "0.5rem", backgroundColor: "#f9fafb", borderRadius: "4px" }}>
                    <code style={{ fontWeight: 600 }}>M</code> - 1
                  </div>
                  <div style={{ padding: "0.5rem", backgroundColor: "#f9fafb", borderRadius: "4px" }}>
                    <code style={{ fontWeight: 600 }}>MMM</code> - Jan
                  </div>
                  <div style={{ padding: "0.5rem", backgroundColor: "#f9fafb", borderRadius: "4px" }}>
                    <code style={{ fontWeight: 600 }}>MMMM</code> - January
                  </div>
                </div>
              </div>

              <div>
                <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "1rem", fontWeight: 600, color: "#374151" }}>
                  Day Formats
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.875rem" }}>
                  <div style={{ padding: "0.5rem", backgroundColor: "#f9fafb", borderRadius: "4px" }}>
                    <code style={{ fontWeight: 600 }}>DD</code> - 15
                  </div>
                  <div style={{ padding: "0.5rem", backgroundColor: "#f9fafb", borderRadius: "4px" }}>
                    <code style={{ fontWeight: 600 }}>D</code> - 15
                  </div>
                </div>
              </div>

              <div>
                <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "1rem", fontWeight: 600, color: "#374151" }}>
                  Day of Week Formats
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.875rem" }}>
                  <div style={{ padding: "0.5rem", backgroundColor: "#f9fafb", borderRadius: "4px" }}>
                    <code style={{ fontWeight: 600 }}>ddd</code> - Mon
                  </div>
                  <div style={{ padding: "0.5rem", backgroundColor: "#f9fafb", borderRadius: "4px" }}>
                    <code style={{ fontWeight: 600 }}>dddd</code> - Monday
                  </div>
                </div>
              </div>

              <div>
                <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "1rem", fontWeight: 600, color: "#374151" }}>
                  Common Examples
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.875rem" }}>
                  <div style={{ padding: "0.75rem", backgroundColor: "#f9fafb", borderRadius: "6px" }}>
                    <code style={{ fontWeight: 600 }}>YYYY-MM-DD</code> → 2024-01-15
                  </div>
                  <div style={{ padding: "0.75rem", backgroundColor: "#f9fafb", borderRadius: "6px" }}>
                    <code style={{ fontWeight: 600 }}>MM/DD/YYYY</code> → 01/15/2024
                  </div>
                  <div style={{ padding: "0.75rem", backgroundColor: "#f9fafb", borderRadius: "6px" }}>
                    <code style={{ fontWeight: 600 }}>DD/MM/YYYY</code> → 15/01/2024
                  </div>
                  <div style={{ padding: "0.75rem", backgroundColor: "#f9fafb", borderRadius: "6px" }}>
                    <code style={{ fontWeight: 600 }}>MMM DD, YYYY</code> → Jan 15, 2024
                  </div>
                  <div style={{ padding: "0.75rem", backgroundColor: "#f9fafb", borderRadius: "6px" }}>
                    <code style={{ fontWeight: 600 }}>MMMM DD, YYYY</code> → January 15, 2024
                  </div>
                  <div style={{ padding: "0.75rem", backgroundColor: "#f9fafb", borderRadius: "6px" }}>
                    <code style={{ fontWeight: 600 }}>dddd, MMMM DD, YYYY</code> → Monday, January 15, 2024
                  </div>
                  <div style={{ padding: "0.75rem", backgroundColor: "#f9fafb", borderRadius: "6px" }}>
                    <code style={{ fontWeight: 600 }}>ddd MMM DD</code> → Mon Jan 15
                  </div>
                  <div style={{ padding: "0.75rem", backgroundColor: "#f9fafb", borderRadius: "6px" }}>
                    <code style={{ fontWeight: 600 }}>MMM DD</code> → Jan 15
                  </div>
                </div>
              </div>

              <div style={{ padding: "1rem", backgroundColor: "#eff6ff", borderRadius: "6px", border: "1px solid #dbeafe" }}>
                <p style={{ margin: 0, fontSize: "0.875rem", color: "#1e40af" }}>
                  <strong>Tip:</strong> You can combine any of these format codes with spaces, commas, hyphens, or other characters to create your preferred date format.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const createInitials = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "?";
  }
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 1) {
    return tokens[0].slice(0, 2).toUpperCase();
  }
  const [first, second] = tokens;
  return `${first[0]}${second[0]}`.toUpperCase();
};

interface StatusFooterProps {
  readonly indicator: { label: string; color: string };
}

const StatusFooter = ({ indicator }: StatusFooterProps) => (
  <div
    style={{
      marginTop: "auto",
      paddingTop: "1.5rem",
      display: "flex",
      alignItems: "center",
      gap: "0.5rem",
      color: "#4b5563",
      fontSize: "0.875rem"
    }}
  >
    <span
      aria-hidden="true"
      style={{
        width: "12px",
        height: "12px",
        borderRadius: "9999px",
        backgroundColor: indicator.color,
        display: "inline-block",
        boxShadow: "inset 0 0 0 1px rgba(15, 23, 42, 0.1)"
      }}
    />
    <span>{indicator.label}</span>
  </div>
);

interface ProfileDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly userName: string;
  readonly userEmail: string;
  readonly profileImage: string | null;
  readonly onProfileImageSelected: (image: string | null) => void;
  readonly rememberDevice: boolean;
  readonly onRememberDeviceChange: (nextValue: boolean) => Promise<void>;
  readonly onLogout: () => Promise<void>;
  readonly onLogoutEverywhere: () => Promise<void>;
}

const ProfileDialog = ({
  isOpen,
  onClose,
  userName,
  userEmail,
  profileImage,
  onProfileImageSelected,
  rememberDevice,
  onRememberDeviceChange,
  onLogout,
  onLogoutEverywhere
}: ProfileDialogProps) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const initials = useMemo(() => createInitials(userName || userEmail), [userName, userEmail]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [isOpen]);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files && event.target.files[0];
      if (!file) {
        return;
      }
      event.target.value = "";
      if (file.size > MAX_PROFILE_IMAGE_BYTES) {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          console.warn("Selected profile image exceeds 5MB limit");
        }
        return;
      }
      try {
        const result = await readFileAsDataUrl(file);
        onProfileImageSelected(result);
      } catch (error) {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          console.warn("Failed to read profile image", error);
        }
      }
    },
    [onProfileImageSelected]
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 40,
        padding: "1.5rem"
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="profile-dialog-title"
        style={{
          width: "360px",
          maxWidth: "100%",
          background: "#ffffff",
          borderRadius: "0.75rem",
          boxShadow: "0 20px 50px rgba(15, 23, 42, 0.25)",
          padding: "1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          outline: "none"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 id="profile-dialog-title" style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600 }}>
              Profile
            </h2>
            <p style={{ margin: "0.25rem 0 0", color: "#6b7280", fontSize: "0.875rem" }}>{userEmail}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              color: "#6b7280",
              cursor: "pointer",
              fontSize: "1.25rem",
              lineHeight: 1
            }}
            aria-label="Close profile dialog"
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: "96px",
              height: "96px",
              borderRadius: "9999px",
              border: "2px dashed #d1d5db",
              background: "#f9fafb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              cursor: "pointer",
              position: "relative"
            }}
            aria-label="Upload profile picture"
          >
            {profileImage ? (
              <img src={profileImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ fontSize: "1.75rem", fontWeight: 600, color: "#9ca3af" }}>{initials}</span>
            )}
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                bottom: 0,
                width: "100%",
                padding: "0.25rem 0",
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                background: "rgba(17, 24, 39, 0.6)",
                color: "#f3f4f6"
              }}
            >
              Change
            </span>
          </button>
          <div style={{ fontSize: "0.875rem", color: "#4b5563" }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{userName}</p>
            <p style={{ margin: "0.25rem 0 1rem" }}>Click the avatar to upload a new photo.</p>
            {profileImage ? (
              <button
                type="button"
                onClick={() => onProfileImageSelected(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#ef4444",
                  cursor: "pointer",
                  padding: 0
                }}
              >
                Remove photo
              </button>
            ) : null}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />

        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", color: "#374151" }}>
          <input
            type="checkbox"
            checked={rememberDevice}
            onChange={(event) => {
              void onRememberDeviceChange(event.target.checked);
            }}
          />
          Remember this device
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={() => {
              void onLogoutEverywhere();
            }}
            style={{
              padding: "0.75rem",
              borderRadius: "0.5rem",
              border: "1px solid #e5e7eb",
              background: "#f9fafb",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Log out everywhere
          </button>
          <button
            type="button"
            onClick={() => {
              void onLogout();
            }}
            style={{
              padding: "0.75rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "#ef4444",
              color: "#ffffff",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Log out
          </button>
        </div>
        <AuthErrorNotice role="status" />
      </div>
    </div>
  );
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const { result } = reader;
      if (typeof result === "string") {
        resolve(result);
      } else {
        reject(new Error("Unsupported file result type"));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read file"));
    };
    reader.readAsDataURL(file);
  });

const useProfileImage = (userId: string | null) => {
  const storageKey = useMemo(
    () => (userId ? `${PROFILE_IMAGE_STORAGE_PREFIX}${userId}` : null),
    [userId]
  );
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    if (!storageKey) {
      setImage(null);
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        setImage(stored);
      } else {
        setImage(null);
      }
    } catch (error) {
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("Failed to load cached profile image", error);
      }
      setImage(null);
    }
  }, [storageKey]);

  const updateImage = useCallback(
    (next: string | null) => {
      setImage(next);
      if (!storageKey || typeof window === "undefined") {
        return;
      }
      try {
        if (next) {
          window.localStorage.setItem(storageKey, next);
        } else {
          window.localStorage.removeItem(storageKey);
        }
      } catch (error) {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          console.warn("Failed to persist profile image", error);
        }
      }
    },
    [storageKey]
  );

  return [image, updateImage] as const;
};
