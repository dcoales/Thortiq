/**
 * Computes breadcrumb descriptors and display items while watching layout
 * constraints.  The hook abstracts measurement, ellipsis handling, and
 * derived labels so the outline header rendering logic can stay declarative.
 */
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {Doc as YDoc} from 'yjs';

import {initializeCollections} from '../../yjs/doc';
import {htmlToPlainText} from '../../utils/text';
import type {NodeId, NodeRecord} from '../../types';
import type {FocusPathEntry} from './useOutlineFocusHistory';

const UNTITLED_LABEL = 'Untitled';

export interface BreadcrumbDescriptor {
  readonly key: string;
  readonly entry: FocusPathEntry;
  readonly node: NodeRecord | null;
  readonly label: string;
  readonly accessibleLabel: string;
  readonly index: number;
  readonly isLast: boolean;
  readonly isRoot: boolean;
}

export interface BreadcrumbEllipsisGroup {
  readonly key: string;
  readonly descriptors: readonly BreadcrumbDescriptor[];
  readonly startIndex: number;
}

export type BreadcrumbDisplayItem =
  | {readonly kind: 'descriptor'; readonly descriptor: BreadcrumbDescriptor}
  | {readonly kind: 'ellipsis'; readonly group: BreadcrumbEllipsisGroup};

export interface BreadcrumbLayout {
  readonly descriptors: readonly BreadcrumbDescriptor[];
  readonly displayItems: readonly BreadcrumbDisplayItem[];
  readonly hiddenGroups: readonly BreadcrumbEllipsisGroup[];
  readonly openEllipsisKey: string | null;
  readonly setOpenEllipsisKey: (key: string | null) => void;
  readonly breadcrumbContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  readonly registerMeasurement: (key: string) => (element: HTMLDivElement | null) => void;
  readonly ellipsisMeasurementRef: React.MutableRefObject<HTMLDivElement | null>;
  readonly registerEllipsisContainer: (key: string) => (element: HTMLDivElement | null) => void;
}

interface UseBreadcrumbLayoutArgs {
  readonly doc: YDoc;
  readonly docVersion: number;
  readonly focusPath: readonly FocusPathEntry[];
  readonly rootId: NodeId;
}

export const useBreadcrumbLayout = ({
  doc,
  docVersion,
  focusPath,
  rootId
}: UseBreadcrumbLayoutArgs): BreadcrumbLayout => {
  const breadcrumbContainerRef = useRef<HTMLDivElement>(null);
  const measurementRefs = useRef(new Map<string, HTMLDivElement | null>());
  const ellipsisMeasurementRef = useRef<HTMLDivElement | null>(null);
  const ellipsisContainerRefs = useRef(new Map<string, HTMLDivElement | null>());
  const [containerWidth, setContainerWidth] = useState(0);
  const [itemWidths, setItemWidths] = useState<Map<string, number>>(() => new Map());
  const [ellipsisWidth, setEllipsisWidth] = useState(32);
  const [openEllipsisKey, setOpenEllipsisKey] = useState<string | null>(null);

  useLayoutEffect(() => {
    const element = breadcrumbContainerRef.current;
    if (!element) {
      return;
    }
    if (typeof ResizeObserver === 'undefined') {
      setContainerWidth(element.clientWidth);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      if (!entries[0]) {
        return;
      }
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (measurementRefs.current.size === 0) {
      setItemWidths((previous) => (previous.size === 0 ? previous : new Map()));
      return;
    }

    const widths = new Map<string, number>();
    measurementRefs.current.forEach((element, key) => {
      if (!element) {
        return;
      }
      const rect = element.getBoundingClientRect();
      widths.set(key, Math.ceil(rect.width));
    });

    setItemWidths((previous) => {
      let changed = previous.size !== widths.size;
      if (!changed) {
        widths.forEach((value, key) => {
          if (previous.get(key) !== value) {
            changed = true;
          }
        });
        previous.forEach((_, key) => {
          if (!widths.has(key)) {
            changed = true;
          }
        });
      }
      return changed ? widths : previous;
    });
  }, [docVersion, focusPath]);

  useLayoutEffect(() => {
    const element = ellipsisMeasurementRef.current;
    if (!element) {
      return;
    }
    const rect = element.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    if (width > 0) {
      setEllipsisWidth((current) => (current === width ? current : width));
    }
  }, [docVersion]);

  const descriptors = useMemo<BreadcrumbDescriptor[]>(() => {
    const {nodes} = initializeCollections(doc);
    return focusPath.map((entry, index) => {
      const node = nodes.get(entry.nodeId) ?? null;
      const plain = node ? htmlToPlainText(node.html).trim() : '';
      const isRoot = entry.nodeId === rootId && entry.edgeId === null;
      const fallback = isRoot ? 'Home' : UNTITLED_LABEL;
      const label = plain.length > 0 ? plain : fallback;
      const accessibleLabel = label;
      const key = entry.edgeId ?? `root:${entry.nodeId}`;
      return {
        key,
        entry,
        node,
        label,
        accessibleLabel,
        index,
        isLast: index === focusPath.length - 1,
        isRoot
      };
    });
  }, [doc, docVersion, focusPath, rootId]);

  const layout = useMemo(() => {
    if (descriptors.length === 0) {
      return {items: [] as BreadcrumbDisplayItem[], hiddenGroups: [] as BreadcrumbEllipsisGroup[]};
    }

    const available = containerWidth;
    if (available <= 0) {
      const items = descriptors.map((descriptor) => ({kind: 'descriptor', descriptor}) as BreadcrumbDisplayItem);
      return {items, hiddenGroups: [] as BreadcrumbEllipsisGroup[]};
    }

    const getWidth = (key: string) => itemWidths.get(key) ?? 0;
    const descriptorsCount = descriptors.length;
    const widths = descriptors.map((descriptor) => getWidth(descriptor.key));
    const totalWidth = widths.reduce((sum, width) => sum + width, 0);

    if (totalWidth <= available || descriptorsCount <= 2) {
      const items = descriptors.map((descriptor) => ({kind: 'descriptor', descriptor}) as BreadcrumbDisplayItem);
      return {items, hiddenGroups: [] as BreadcrumbEllipsisGroup[]};
    }

    let bestBlock: {start: number; end: number; hiddenCount: number} | null = null;
    const lastIndex = descriptorsCount - 1;
    for (let start = 1; start <= lastIndex - 1; start += 1) {
      let hiddenWidth = 0;
      for (let end = start; end <= lastIndex - 1; end += 1) {
        hiddenWidth += widths[end];
        const widthWithEllipsis = totalWidth - hiddenWidth + ellipsisWidth;
        if (widthWithEllipsis <= available) {
          const hiddenCount = end - start + 1;
          if (!bestBlock || hiddenCount < bestBlock.hiddenCount || start < bestBlock.start) {
            bestBlock = {start, end, hiddenCount};
          }
          break;
        }
      }
    }

    if (!bestBlock) {
      const lastDescriptor = descriptors[lastIndex];
      const items: BreadcrumbDisplayItem[] = [{kind: 'descriptor', descriptor: lastDescriptor}];
      return {items, hiddenGroups: [] as BreadcrumbEllipsisGroup[]};
    }

    const {start, end} = bestBlock;
    const hidden = descriptors.slice(start, end + 1);
    const groupKey = `ellipsis:${start}:${end}:${hidden[hidden.length - 1]?.key ?? 'end'}`;
    const group: BreadcrumbEllipsisGroup = {
      key: groupKey,
      descriptors: hidden,
      startIndex: start
    };

    const items: BreadcrumbDisplayItem[] = [
      ...descriptors.slice(0, start).map((descriptor) => ({kind: 'descriptor', descriptor}) as BreadcrumbDisplayItem),
      {kind: 'ellipsis', group},
      ...descriptors.slice(end + 1).map((descriptor) => ({kind: 'descriptor', descriptor}) as BreadcrumbDisplayItem)
    ];

    return {items, hiddenGroups: [group]};
  }, [containerWidth, descriptors, itemWidths, ellipsisWidth]);

  const {items: displayItems, hiddenGroups} = layout;

  useEffect(() => {
    if (hiddenGroups.length === 0) {
      setOpenEllipsisKey(null);
    }
  }, [hiddenGroups.length]);

  useEffect(() => {
    if (!openEllipsisKey) {
      return;
    }
    const groupStillVisible = hiddenGroups.some((group) => group.key === openEllipsisKey);
    if (!groupStillVisible) {
      setOpenEllipsisKey(null);
    }
  }, [hiddenGroups, openEllipsisKey]);

  useEffect(() => {
    setOpenEllipsisKey(null);
  }, [focusPath]);

  useEffect(() => {
    if (!openEllipsisKey || typeof window === 'undefined') {
      return undefined;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const container = ellipsisContainerRefs.current.get(openEllipsisKey);
      if (container && container.contains(event.target as Node)) {
        return;
      }
      setOpenEllipsisKey(null);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [hiddenGroups, openEllipsisKey]);

  const registerMeasurement = useCallback(
    (key: string) => (element: HTMLDivElement | null) => {
      if (element) {
        measurementRefs.current.set(key, element);
      } else {
        measurementRefs.current.delete(key);
      }
    },
    []
  );

  const registerEllipsisContainer = useCallback(
    (key: string) => (element: HTMLDivElement | null) => {
      if (element) {
        ellipsisContainerRefs.current.set(key, element);
      } else {
        ellipsisContainerRefs.current.delete(key);
      }
    },
    []
  );

  return {
    descriptors,
    displayItems,
    hiddenGroups,
    openEllipsisKey,
    setOpenEllipsisKey,
    breadcrumbContainerRef,
    registerMeasurement,
    ellipsisMeasurementRef,
    registerEllipsisContainer
  };
};
