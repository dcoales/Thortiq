/**
 * React hook that exposes the current inbox and journal assignments from the shared outline.
 * Listeners subscribe to the Yjs-backed userPreferences map so consumers stay in sync with
 * singleton role changes without polling the document or wiring custom observers.
 */
import { useEffect, useState } from "react";
import type { Transaction as YTransaction, YMapEvent } from "yjs";

import {
  getInboxNodeId,
  getJournalNodeId,
  type NodeId,
  type OutlineDoc
} from "@thortiq/client-core";

import { useSyncContext } from "./OutlineProvider";

export interface OutlineSingletonAssignments {
  readonly inboxNodeId: NodeId | null;
  readonly journalNodeId: NodeId | null;
}

const readAssignments = (outline: OutlineDoc): OutlineSingletonAssignments => {
  return {
    inboxNodeId: getInboxNodeId(outline),
    journalNodeId: getJournalNodeId(outline)
  };
};

export const useOutlineSingletonNodes = (): OutlineSingletonAssignments => {
  const { outline } = useSyncContext();

  const [assignments, setAssignments] = useState<OutlineSingletonAssignments>(() => readAssignments(outline));

  useEffect(() => {
    const preferences = outline.userPreferences;
    const applySnapshot = () => {
      setAssignments((current) => {
        const next = readAssignments(outline);
        if (current.inboxNodeId === next.inboxNodeId && current.journalNodeId === next.journalNodeId) {
          return current;
        }
        return next;
      });
    };

    const handleChange = (event: YMapEvent<unknown>, transaction: YTransaction) => {
      void event;
      void transaction;
      applySnapshot();
    };

    applySnapshot();
    preferences.observe(handleChange);
    return () => {
      preferences.unobserve(handleChange);
    };
  }, [outline]);

  return assignments;
};
