/**
 * Authenticated application shell providing a resizable navigation pane with profile controls.
 * The layout replaces the previous header + device list so the outline view remains the focus
 * while account management lives inside a lightweight dialog triggered from the left rail.
 */
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AuthErrorNotice,
  useAuthActions,
  useAuthRememberDevicePreference,
  useAuthSession
} from "@thortiq/client-react";

import type { SyncManagerStatus } from "../outline/OutlineProvider";
import { OutlineProvider, useSyncStatus } from "../outline/OutlineProvider";
import { OutlineView } from "../outline/OutlineView";

const PANE_MIN_WIDTH = 224;
const PANE_MAX_WIDTH = 440;
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
  const [paneWidth, setPaneWidth] = useState(272);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const paneHandleRef = useRef<HTMLDivElement | null>(null);
  const avatarButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isProfileDialogOpen, setProfileDialogOpen] = useState(false);
  const syncStatus = useSyncStatus();
  const [profileImage, setProfileImage] = useProfileImage(session.user.id);
  const initials = useMemo(() => createInitials(session.user.displayName || session.user.email), [
    session.user.displayName,
    session.user.email
  ]);
  const statusIndicator = useMemo(() => createStatusIndicator(syncStatus), [syncStatus]);
  const visibleName = session.user.displayName || session.user.email;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragState.current) {
        return;
      }
      const delta = event.clientX - dragState.current.startX;
      const nextWidth = Math.min(
        PANE_MAX_WIDTH,
        Math.max(PANE_MIN_WIDTH, dragState.current.startWidth + delta)
      );
      setPaneWidth(nextWidth);
    };
    const handlePointerUp = () => {
      dragState.current = null;
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
  }, [paneWidth]);

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

  return (
    <>
      <div style={{ display: "flex", minHeight: "100vh", width: "100%" }}>
        <aside
          style={{
            width: `${paneWidth}px`,
            borderRight: "1px solid #e5e7eb",
            background: "#f9fafb",
            display: "flex",
            flexDirection: "column",
            padding: "1rem"
          }}
        >
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
              <span style={{ fontWeight: 600, color: "#111827" }}>{visibleName}</span>
              <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>{session.user.email}</span>
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
          <div style={{ flex: 1 }} />
          <StatusFooter indicator={statusIndicator} />
        </aside>
        <div
          ref={paneHandleRef}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize side panel"
          tabIndex={0}
          style={{
            width: "6px",
            cursor: "col-resize",
            background: "transparent",
            position: "relative"
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setPaneWidth((current) => Math.max(PANE_MIN_WIDTH, current - 16));
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              setPaneWidth((current) => Math.min(PANE_MAX_WIDTH, current + 16));
            }
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: "0",
              background: "transparent"
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <OutlineView paneId="outline" />
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
    </>
  );
};

const createStatusIndicator = (status: SyncManagerStatus) => {
  const normalized = status.charAt(0).toUpperCase() + status.slice(1);
  const color = status === "connected" ? "#10b981" : "#9ca3af";
  return { label: normalized, color };
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
