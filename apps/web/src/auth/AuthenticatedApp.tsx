import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

import {
  AuthErrorNotice,
  useAuthActions,
  useAuthRememberDevicePreference,
  useAuthSession,
  useAuthSessions
} from "@thortiq/client-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { OutlineProvider } from "../outline/OutlineProvider";
import { OutlineView } from "../outline/OutlineView";

const formatRelativeTime = (value: number): string => {
  const delta = Date.now() - value;
  if (Number.isNaN(delta)) {
    return "Unknown";
  }
  if (delta < 60_000) {
    return "Just now";
  }
  if (delta < 3_600_000) {
    const minutes = Math.round(delta / 60_000);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.round(delta / 3_600_000);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.round(delta / 86_400_000);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

const SessionsPanel = () => {
  const { loadSessions } = useAuthActions();
  const sessions = useAuthSessions();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 4
  });

  useEffect(() => {
    loadSessions().catch((error) => {
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("Failed to load sessions", error);
      }
    });
  }, [loadSessions]);

  return (
    <section className="session-panel">
      <div className="session-panel__header">
        <h2>Devices</h2>
        <button type="button" onClick={() => loadSessions()}>
          Refresh
        </button>
      </div>
      <div ref={scrollRef} className="session-panel__scroll" style={{ height: 240, overflow: "auto" }}>
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const session = sessions[virtualRow.index];
            const style: CSSProperties = {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`
            };
            return (
              <div key={session.id} style={style} className="session-row" data-current={session.current}>
                <div className="session-row__primary">
                  <strong>{session.device.displayName}</strong>
                  <span>{session.device.platform}</span>
                </div>
                <div className="session-row__meta">
                  <span>Last active {formatRelativeTime(session.lastActiveAt)}</span>
                  {session.ipAddress ? <span>{session.ipAddress}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <AuthErrorNotice role="status" />
    </section>
  );
};

export const AuthenticatedApp = () => {
  const session = useAuthSession();
  const { logout, logoutEverywhere, updateRememberDevice } = useAuthActions();
  const rememberDevice = useAuthRememberDevicePreference();

  if (!session) {
    return null;
  }

  return (
    <OutlineProvider>
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "0.75rem",
            padding: "0.75rem 1rem",
            borderBottom: "1px solid #e5e7eb"
          }}
        >
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={async (event) => {
                  try {
                    await updateRememberDevice(event.target.checked);
                  } catch (error) {
                    if (typeof console !== "undefined" && typeof console.warn === "function") {
                      console.warn("Failed to update remember device preference", error);
                    }
                  }
                }}
              />
              Remember this device
            </label>
          <button
            type="button"
            onClick={async () => {
              try {
                await logoutEverywhere();
              } catch (error) {
                if (typeof console !== "undefined" && typeof console.warn === "function") {
                  console.warn("Failed to log out everywhere", error);
                }
              }
            }}
          >
            Log out everywhere
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                await logout();
              } catch (error) {
                if (typeof console !== "undefined" && typeof console.warn === "function") {
                  console.warn("Failed to log out", error);
                }
              }
            }}
          >
            Log out
          </button>
        </header>
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <OutlineView paneId="outline" />
          </div>
          <div style={{ width: "320px", borderLeft: "1px solid #e5e7eb", padding: "1rem", overflow: "hidden" }}>
            <SessionsPanel />
          </div>
        </div>
      </div>
    </OutlineProvider>
  );
};
