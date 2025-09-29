import { describe, expect, it } from "vitest";

import { createSyncContext } from "./index";
import { claimBootstrap, markBootstrapComplete, releaseBootstrapClaim } from "./bootstrap";

const createOutline = () => {
  const sync = createSyncContext();
  return sync;
};

describe("bootstrap helpers", () => {
  it("allows a single claim before marking seeded", () => {
    const { outline, localOrigin } = createOutline();

    const first = claimBootstrap(outline, localOrigin);
    expect(first.claimed).toBe(true);
    expect(first.state).toBe("bootstrapping");

    const second = claimBootstrap(outline, localOrigin);
    expect(second.claimed).toBe(false);
    expect(second.state).toBe("bootstrapping");

    markBootstrapComplete(outline, localOrigin);

    const third = claimBootstrap(outline, localOrigin);
    expect(third.claimed).toBe(false);
    expect(third.state).toBe("seeded");
  });

  it("can release a claim if seeding fails", () => {
    const { outline, localOrigin } = createOutline();

    const claim = claimBootstrap(outline, localOrigin);
    expect(claim.claimed).toBe(true);

    releaseBootstrapClaim(outline, localOrigin);

    const retry = claimBootstrap(outline, localOrigin);
    expect(retry.claimed).toBe(true);
  });
});
