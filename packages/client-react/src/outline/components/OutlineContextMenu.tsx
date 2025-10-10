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
  OutlineContextMenuNode,
  OutlineContextMenuSubmenuDescriptor
} from "@thortiq/client-core";

export interface OutlineContextMenuProps {
  readonly anchor: { readonly x: number; readonly y: number };
  readonly nodes: readonly OutlineContextMenuNode[];
  readonly executionContext: OutlineContextMenuExecutionContext;
  readonly onClose: () => void;
  readonly portalContainer?: HTMLElement | null;
}

interface MenuItemRuntime {
  readonly descriptor: OutlineContextMenuCommandDescriptor | OutlineContextMenuSubmenuDescriptor;
  readonly enabled: boolean;
}

interface OpenSubmenuState {
  readonly descriptor: OutlineContextMenuSubmenuDescriptor;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly trigger: HTMLButtonElement | null;
  readonly autoFocus: boolean;
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

const submenuIndicatorStyle: CSSProperties = {
  marginLeft: "auto",
  fontSize: "0.8rem",
  color: "rgba(226, 232, 240, 0.6)"
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

interface ContextMenuContentProps {
  readonly level: number;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly nodes: readonly OutlineContextMenuNode[];
  readonly executionContext: OutlineContextMenuExecutionContext;
  readonly onCloseAll: () => void;
  readonly portalHost: HTMLElement;
  readonly registerContainer: (element: HTMLDivElement) => void;
  readonly unregisterContainer: (element: HTMLDivElement) => void;
  readonly onRequestCloseParent?: () => void;
  readonly autoFocus?: boolean;
}

const ContextMenuContent = ({
  level,
  anchor,
  nodes,
  executionContext,
  onCloseAll,
  portalHost,
  registerContainer,
  unregisterContainer,
  onRequestCloseParent,
  autoFocus = level === 0
}: ContextMenuContentProps): JSX.Element | null => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState(anchor);
  const [focusIndex, setFocusIndex] = useState<number>(-1);
  const [pendingCommandId, setPendingCommandId] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<OpenSubmenuState | null>(null);

  const actionableNodes = useMemo<Array<MenuItemRuntime | null>>(() => {
    return nodes.map((node) => {
      if (node.type === "command" || node.type === "submenu") {
        const enabled = node.isEnabled ? node.isEnabled(executionContext) : true;
        return { descriptor: node, enabled };
      }
      return null;
    });
  }, [executionContext, nodes]);

  useLayoutEffect(() => {
    if (!menuRef.current) {
      return;
    }
    setPosition(measureSafePosition(anchor, menuRef.current));
  }, [anchor]);

  useEffect(() => {
    const element = menuRef.current;
    if (!element) {
      return;
    }
    registerContainer(element);
    return () => {
      unregisterContainer(element);
    };
  }, [registerContainer, unregisterContainer]);

  useEffect(() => {
    if (!autoFocus) {
      return;
    }
    const firstEnabledIndex = nodes.findIndex((node, index) => {
      if (node.type === "separator") {
        return false;
      }
      const runtime = actionableNodes[index];
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
  }, [actionableNodes, autoFocus, nodes]);

  const closeSubmenu = useCallback((focusParent: boolean) => {
    setOpenSubmenu((current) => {
      if (focusParent && current?.trigger) {
        current.trigger.focus();
      }
      return null;
    });
  }, []);

  const focusNext = useCallback(
    (delta: 1 | -1) => {
      if (nodes.length === 0) {
        return;
      }
      let nextIndex = focusIndex >= 0 ? focusIndex : 0;
      for (let iteration = 0; iteration < nodes.length; iteration += 1) {
        nextIndex = (nextIndex + delta + nodes.length) % nodes.length;
        const candidate = nodes[nextIndex];
        if (!candidate || candidate.type === "separator") {
          continue;
        }
        const enabled = actionableNodes[nextIndex]?.enabled ?? false;
        if (!enabled) {
          continue;
        }
        setFocusIndex(nextIndex);
        const ref = itemRefs.current[nextIndex];
        ref?.focus();
        if (candidate.type !== "submenu") {
          setOpenSubmenu(null);
        }
        break;
      }
    },
    [actionableNodes, focusIndex, nodes]
  );

  const openSubmenuAtIndex = useCallback(
    (index: number, options: { readonly autoFocus: boolean }) => {
      const node = nodes[index];
      if (!node || node.type !== "submenu") {
        return;
      }
      const enabled = actionableNodes[index]?.enabled ?? false;
      if (!enabled) {
        return;
      }
      const trigger = itemRefs.current[index];
      if (!trigger) {
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const anchorPosition = {
        x: rect.right + 6,
        y: rect.top
      };
      setOpenSubmenu({
        descriptor: node,
        anchor: anchorPosition,
        trigger,
        autoFocus: options.autoFocus
      });
    },
    [actionableNodes, nodes]
  );

  const activateIndex = useCallback(
    async (index: number) => {
      const node = nodes[index];
      if (!node || node.type === "separator") {
        return;
      }
      const enabled = actionableNodes[index]?.enabled ?? false;
      if (!enabled) {
        return;
      }
      if (node.type === "submenu") {
        openSubmenuAtIndex(index, { autoFocus: true });
        return;
      }
      try {
        setPendingCommandId(node.id);
        const result = await Promise.resolve(node.run(executionContext));
        if (result?.handled) {
          onCloseAll();
        }
      } finally {
        setPendingCommandId(null);
      }
    },
    [actionableNodes, executionContext, nodes, onCloseAll, openSubmenuAtIndex]
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
        const firstEnabled = nodes.findIndex((node, index) => {
          if (node.type === "separator") {
            return false;
          }
          return actionableNodes[index]?.enabled ?? false;
        });
        if (firstEnabled >= 0) {
          setFocusIndex(firstEnabled);
          itemRefs.current[firstEnabled]?.focus();
          if (nodes[firstEnabled]?.type !== "submenu") {
            setOpenSubmenu(null);
          }
        }
        break;
      }
      case "End": {
        event.preventDefault();
        for (let index = nodes.length - 1; index >= 0; index -= 1) {
          const node = nodes[index];
          if (!node || node.type === "separator") {
            continue;
          }
          if (!(actionableNodes[index]?.enabled ?? false)) {
            continue;
          }
          setFocusIndex(index);
          itemRefs.current[index]?.focus();
          if (node.type !== "submenu") {
            setOpenSubmenu(null);
          }
          break;
        }
        break;
      }
      case "ArrowRight": {
        if (focusIndex >= 0 && nodes[focusIndex]?.type === "submenu") {
          event.preventDefault();
          openSubmenuAtIndex(focusIndex, { autoFocus: true });
        }
        break;
      }
      case "ArrowLeft": {
        event.preventDefault();
        if (openSubmenu) {
          closeSubmenu(true);
          break;
        }
        if (onRequestCloseParent) {
          onRequestCloseParent();
        } else {
          onCloseAll();
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

  if (!portalHost) {
    return null;
  }

  itemRefs.current.length = nodes.length;

  const submenuContent = openSubmenu ? (
    <ContextMenuContent
      key={openSubmenu.descriptor.id}
      level={level + 1}
      anchor={openSubmenu.anchor}
      nodes={openSubmenu.descriptor.items}
      executionContext={executionContext}
      onCloseAll={onCloseAll}
      portalHost={portalHost}
      registerContainer={registerContainer}
      unregisterContainer={unregisterContainer}
      onRequestCloseParent={() => {
        setOpenSubmenu(null);
        if (openSubmenu.trigger) {
          openSubmenu.trigger.focus();
        }
      }}
      autoFocus={openSubmenu.autoFocus}
    />
  ) : null;

  const menuNode = (
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
          const runtime = actionableNodes[index];
          const enabled = runtime?.enabled ?? false;
          const pending = node.type === "command" && pendingCommandId === node.id;
          const focusCurrentItem = () => {
            setFocusIndex(index);
            const ref = itemRefs.current[index];
            ref?.focus();
          };

          const commonProps = {
            ref: (button: HTMLButtonElement | null) => {
              itemRefs.current[index] = button;
            },
            type: "button" as const,
            role: "menuitem" as const,
            disabled: !enabled || pending,
            style: {
              ...baseItemStyle,
              ...(focusIndex === index ? itemActiveStyle : undefined),
              ...(!enabled || pending ? itemDisabledStyle : undefined)
            }
          };

          if (node.type === "command") {
            return (
              <li key={node.id}>
                <button
                  {...commonProps}
                  data-outline-context-menu-item="command"
                  aria-label={node.ariaLabel ?? node.label}
                  onMouseEnter={() => {
                    focusCurrentItem();
                    setOpenSubmenu(null);
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void activateIndex(index);
                  }}
                >
                  <span>{node.label}</span>
                  {node.shortcut ? <span style={shortcutStyle}>{node.shortcut}</span> : null}
                </button>
              </li>
            );
          }

          return (
            <li key={node.id}>
              <button
                {...commonProps}
                data-outline-context-menu-item="submenu"
                aria-haspopup="menu"
                aria-expanded={openSubmenu?.descriptor.id === node.id}
                aria-label={node.ariaLabel ?? node.label}
                onMouseEnter={() => {
                  focusCurrentItem();
                  openSubmenuAtIndex(index, { autoFocus: false });
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openSubmenuAtIndex(index, { autoFocus: true });
                }}
              >
                <span>{node.label}</span>
                <span style={submenuIndicatorStyle} aria-hidden>
                  ›
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <>
      {createPortal(menuNode, portalHost)}
      {submenuContent}
    </>
  );
};

export const OutlineContextMenu = ({
  anchor,
  nodes,
  executionContext,
  onClose,
  portalContainer
}: OutlineContextMenuProps): JSX.Element | null => {
  const host = getPortalHost(portalContainer);
  const containerRegistry = useRef<Set<HTMLDivElement>>(new Set());

  const registerContainer = useCallback((element: HTMLDivElement) => {
    containerRegistry.current.add(element);
  }, []);

  const unregisterContainer = useCallback((element: HTMLDivElement) => {
    containerRegistry.current.delete(element);
  }, []);

  useEffect(() => {
    const containsTarget = (target: Node | null): boolean => {
      if (!target) {
        return false;
      }
      for (const container of containerRegistry.current) {
        if (container.contains(target)) {
          return true;
        }
      }
      return false;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (containsTarget(event.target as Node)) {
        return;
      }
      onClose();
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (containsTarget(event.target as Node)) {
        return;
      }
      event.preventDefault();
      onClose();
    };

    const handleWheel = (event: WheelEvent) => {
      if (containsTarget(event.target as Node)) {
        return;
      }
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

  if (!host) {
    return null;
  }

  if (nodes.length === 0) {
    return null;
  }

  return (
    <ContextMenuContent
      level={0}
      anchor={anchor}
      nodes={nodes}
      executionContext={executionContext}
      onCloseAll={onClose}
      portalHost={host}
      registerContainer={registerContainer}
      unregisterContainer={unregisterContainer}
      autoFocus
    />
  );
};
