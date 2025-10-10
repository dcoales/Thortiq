import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from "react";

import type {
  OutlineContextMenuCommandDescriptor,
  OutlineContextMenuExecutionContext,
  OutlineContextMenuNode
} from "@thortiq/client-core";

export interface OutlineContextMenuProps {
  readonly anchor: { readonly x: number; readonly y: number };
  readonly nodes: readonly OutlineContextMenuNode[];
  readonly executionContext: OutlineContextMenuExecutionContext;
  readonly onClose: () => void;
  readonly portalContainer?: HTMLElement | null;
}

interface MenuItemRuntime {
  readonly descriptor: OutlineContextMenuCommandDescriptor;
  readonly enabled: boolean;
}

const menuStyle: CSSProperties = {
  position: "fixed",
  minWidth: "224px",
  backgroundColor: "rgba(17, 24, 39, 0.975)",
  color: "#f9fafb",
  borderRadius: "10px",
  boxShadow: "0 18px 32px rgba(15, 23, 42, 0.4)",
  padding: "6px 0",
  zIndex: 90
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  padding: 0,
  margin: 0,
  listStyle: "none"
};

const baseItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
  width: "100%",
  border: "none",
  background: "transparent",
  color: "inherit",
  fontSize: "0.9rem",
  padding: "6px 14px",
  textAlign: "left",
  cursor: "pointer",
  borderRadius: "8px"
};

const itemActiveStyle: CSSProperties = {
  backgroundColor: "rgba(59, 130, 246, 0.22)"
};

const itemDisabledStyle: CSSProperties = {
  opacity: 0.45,
  cursor: "not-allowed"
};

const shortcutStyle: CSSProperties = {
  fontSize: "0.75rem",
  color: "rgba(226, 232, 240, 0.65)"
};

const separatorStyle: CSSProperties = {
  height: "1px",
  margin: "4px 10px",
  backgroundColor: "rgba(148, 163, 184, 0.35)"
};

const getPortalHost = (explicitHost?: HTMLElement | null): HTMLElement | null => {
  if (explicitHost) {
    return explicitHost;
  }
  if (typeof document !== "undefined") {
    return document.body;
  }
  return null;
};

const measureSafePosition = (
  anchor: { x: number; y: number },
  menu: HTMLDivElement | null
): { x: number; y: number } => {
  if (!menu || typeof window === "undefined") {
    return anchor;
  }
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  return {
    x: Math.max(8, Math.min(anchor.x, maxX)),
    y: Math.max(8, Math.min(anchor.y, maxY))
  };
};

export const OutlineContextMenu = ({
  anchor,
  nodes,
  executionContext,
  onClose,
  portalContainer
}: OutlineContextMenuProps): JSX.Element | null => {
  const host = getPortalHost(portalContainer);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState(anchor);
  const [focusIndex, setFocusIndex] = useState<number>(-1);
  const [pendingCommandId, setPendingCommandId] = useState<string | null>(null);

  const actionableItems = useMemo<MenuItemRuntime[]>(() => {
    return nodes
      .filter((node): node is OutlineContextMenuCommandDescriptor => node.type === "command")
      .map((descriptor) => ({
        descriptor,
        enabled: descriptor.isEnabled ? descriptor.isEnabled(executionContext) : true
      }));
  }, [executionContext, nodes]);

  useLayoutEffect(() => {
    if (!menuRef.current) {
      return;
    }
    setPosition(measureSafePosition(anchor, menuRef.current));
  }, [anchor]);

  useEffect(() => {
    if (actionableItems.length === 0) {
      return;
    }
    const firstEnabledIndex = nodes.findIndex((node) => {
      if (node.type !== "command") {
        return false;
      }
      const runtime = actionableItems.find((item) => item.descriptor.id === node.id);
      return runtime?.enabled ?? false;
    });
    if (firstEnabledIndex >= 0) {
      setFocusIndex(firstEnabledIndex);
      const ref = itemRefs.current[firstEnabledIndex];
      ref?.focus();
    } else {
      setFocusIndex(-1);
      menuRef.current?.focus();
    }
  }, [actionableItems, nodes]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current) {
        return;
      }
      if (menuRef.current.contains(event.target as Node)) {
        return;
      }
      onClose();
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (!menuRef.current) {
        return;
      }
      if (menuRef.current.contains(event.target as Node)) {
        return;
      }
      event.preventDefault();
      onClose();
    };

    const handleWheel = () => {
      onClose();
    };

    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("wheel", handleWheel, { passive: true, capture: true });
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("wheel", handleWheel, true);
      document.removeEventListener("keydown", handleKey, true);
    };
  }, [onClose]);

  const focusNext = useCallback(
    (delta: 1 | -1) => {
      if (nodes.length === 0) {
        return;
      }
      const commandIndexes = nodes
        .map((node, idx) => ({ node, idx }))
        .filter(({ node }) => node.type === "command");
      if (commandIndexes.length === 0) {
        return;
      }
      const currentIndex = focusIndex >= 0 ? focusIndex : commandIndexes[0]?.idx ?? 0;
      let nextIndex = currentIndex;
      for (let iteration = 0; iteration < commandIndexes.length; iteration += 1) {
        nextIndex = (nextIndex + delta + nodes.length) % nodes.length;
        const candidate = nodes[nextIndex];
        if (candidate?.type !== "command") {
          continue;
        }
        const runtime = actionableItems.find((item) => item.descriptor.id === candidate.id);
        if (!(runtime?.enabled ?? false)) {
          continue;
        }
        setFocusIndex(nextIndex);
        const ref = itemRefs.current[nextIndex];
        ref?.focus();
        break;
      }
    },
    [actionableItems, focusIndex, nodes]
  );

  const activateIndex = useCallback(
    async (index: number) => {
      const node = nodes[index];
      if (!node || node.type !== "command") {
        return;
      }
      const runtime = actionableItems.find((item) => item.descriptor.id === node.id);
      if (!(runtime?.enabled ?? false)) {
        return;
      }
      try {
        setPendingCommandId(node.id);
        const result = await Promise.resolve(node.run(executionContext));
        if (result?.handled) {
          onClose();
        }
      } finally {
        setPendingCommandId(null);
      }
    },
    [actionableItems, executionContext, nodes, onClose]
  );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusNext(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusNext(-1);
        break;
      case "Home": {
        event.preventDefault();
        const firstEnabled = nodes.findIndex((node) => {
          if (node.type !== "command") {
            return false;
          }
          const runtime = actionableItems.find((item) => item.descriptor.id === node.id);
          return runtime?.enabled ?? false;
        });
        if (firstEnabled >= 0) {
          setFocusIndex(firstEnabled);
          itemRefs.current[firstEnabled]?.focus();
        }
        break;
      }
      case "End": {
        event.preventDefault();
        for (let index = nodes.length - 1; index >= 0; index -= 1) {
          const node = nodes[index];
          if (node.type !== "command") {
            continue;
          }
          const runtime = actionableItems.find((item) => item.descriptor.id === node.id);
          if (!(runtime?.enabled ?? false)) {
            continue;
          }
          setFocusIndex(index);
          itemRefs.current[index]?.focus();
          break;
        }
        break;
      }
      case "Enter":
      case " ":
        event.preventDefault();
        if (focusIndex >= 0) {
          void activateIndex(focusIndex);
        }
        break;
      default:
        break;
    }
  };

  if (!host) {
    return null;
  }

  itemRefs.current.length = nodes.length;

  const content = (
    <div
      ref={menuRef}
      style={{
        ...menuStyle,
        left: `${position.x}px`,
        top: `${position.y}px`
      }}
      role="menu"
      tabIndex={-1}
      data-outline-context-menu="true"
      onKeyDown={handleKeyDown}
      onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => {
        event.preventDefault();
      }}
    >
      <ul style={listStyle}>
        {nodes.map((node, index) => {
          if (node.type === "separator") {
            return <li key={node.id} role="separator" style={separatorStyle} />;
          }
          if (node.type !== "command") {
            return null;
          }
          const runtime = actionableItems.find((item) => item.descriptor.id === node.id);
          const enabled = runtime?.enabled ?? true;
          const pending = pendingCommandId === node.id;
          return (
            <li key={node.id}>
              <button
                ref={(button) => {
                  itemRefs.current[index] = button;
                }}
                type="button"
                role="menuitem"
                aria-disabled={!enabled || pending}
                data-outline-context-menu-item="command"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void activateIndex(index);
                }}
                onMouseEnter={() => {
                  setFocusIndex(index);
                  itemRefs.current[index]?.focus();
                }}
                disabled={!enabled || pending}
                style={{
                  ...baseItemStyle,
                  ...(focusIndex === index ? itemActiveStyle : undefined),
                  ...(!enabled || pending ? itemDisabledStyle : undefined)
                }}
              >
                <span>{node.label}</span>
                {node.shortcut ? <span style={shortcutStyle}>{node.shortcut}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return createPortal(content, host);
};
