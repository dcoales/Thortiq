/**
 * Coordinates first-run seeding so only one tab populates the shared document even when
 * multiple sessions start simultaneously. We record a tiny state map inside the Y.Doc that
 * persists through IndexedDB and sync providers.
 */
import { getRootEdgeIds, withTransaction, type OutlineDoc } from "@thortiq/client-core";

const BOOTSTRAP_MAP_KEY = "thortiq:bootstrap";
const BOOTSTRAP_STATE_KEY = "state";
const BOOTSTRAP_VERSION_KEY = "version";
const BOOTSTRAP_VERSION = 1;

export type BootstrapState = "idle" | "bootstrapping" | "seeded";

export interface BootstrapClaim {
  readonly state: BootstrapState;
  readonly claimed: boolean;
}

export const claimBootstrap = (outline: OutlineDoc, origin: unknown): BootstrapClaim => {
  let claimed = false;
  let state: BootstrapState = "idle";

  withTransaction(
    outline,
    () => {
      const map = outline.doc.getMap<unknown>(BOOTSTRAP_MAP_KEY);
      const version = map.get(BOOTSTRAP_VERSION_KEY);
      if (version !== BOOTSTRAP_VERSION) {
        map.set(BOOTSTRAP_VERSION_KEY, BOOTSTRAP_VERSION);
        map.set(BOOTSTRAP_STATE_KEY, "idle");
      }
      const current = map.get(BOOTSTRAP_STATE_KEY);

      if (current === "seeded") {
        state = "seeded";
        return;
      }
      if (current === "bootstrapping") {
        state = "bootstrapping";
        return;
      }
      if (getRootEdgeIds(outline).length > 0) {
        map.set(BOOTSTRAP_STATE_KEY, "seeded");
        state = "seeded";
        return;
      }
      map.set(BOOTSTRAP_STATE_KEY, "bootstrapping");
      state = "bootstrapping";
      claimed = true;
    },
    origin
  );

  return { claimed, state };
};

export const markBootstrapComplete = (outline: OutlineDoc, origin: unknown): void => {
  withTransaction(
    outline,
    () => {
      const map = outline.doc.getMap<unknown>(BOOTSTRAP_MAP_KEY);
      map.set(BOOTSTRAP_STATE_KEY, "seeded");
    },
    origin
  );
};

export const releaseBootstrapClaim = (outline: OutlineDoc, origin: unknown): void => {
  withTransaction(
    outline,
    () => {
      const map = outline.doc.getMap<unknown>(BOOTSTRAP_MAP_KEY);
      map.set(BOOTSTRAP_STATE_KEY, "idle");
    },
    origin
  );
};
