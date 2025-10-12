import { useEffect, useLayoutEffect, useState } from "react";
import type { MutableRefObject } from "react";

interface FixedAnchor {
  readonly left: number;
  readonly top: number;
}

interface FixedPositionOptions {
  readonly padding?: number;
}

interface Offset {
  readonly dx: number;
  readonly dy: number;
}

const clamp = (value: number, min: number, max: number): number => {
  if (max <= min) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const DEFAULT_PADDING = 12;

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export const useClampedFixedPosition = <TElement extends HTMLElement>(
  containerRef: MutableRefObject<TElement | null>,
  anchor: FixedAnchor,
  options?: FixedPositionOptions
): FixedAnchor => {
  const padding = options?.padding ?? DEFAULT_PADDING;
  const [offset, setOffset] = useState<Offset>({ dx: 0, dy: 0 });

  useIsomorphicLayoutEffect(() => {
    setOffset((current) => (current.dx === 0 && current.dy === 0 ? current : { dx: 0, dy: 0 }));
  }, [anchor.left, anchor.top]);

  useIsomorphicLayoutEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const updatePosition = () => {
      const element = containerRef.current;
      if (!element) {
        setOffset((current) => (current.dx === 0 && current.dy === 0 ? current : { dx: 0, dy: 0 }));
        return;
      }
      const rect = element.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const maxLeft = Math.max(viewportWidth - padding - rect.width, padding);
      const maxTop = Math.max(viewportHeight - padding - rect.height, padding);

      const targetLeft = clamp(anchor.left, padding, maxLeft);
      const targetTop = clamp(anchor.top, padding, maxTop);

      const nextOffset: Offset = {
        dx: targetLeft - anchor.left,
        dy: targetTop - anchor.top
      };

      setOffset((current) => {
        if (current.dx === nextOffset.dx && current.dy === nextOffset.dy) {
          return current;
        }
        return nextOffset;
      });
    };

    updatePosition();
    const handleResize = () => {
      updatePosition();
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, [anchor.left, anchor.top, containerRef, padding]);

  return {
    left: anchor.left + offset.dx,
    top: anchor.top + offset.dy
  };
};
