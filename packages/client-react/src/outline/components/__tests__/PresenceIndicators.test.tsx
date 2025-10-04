import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { OutlinePresenceParticipant } from "@thortiq/client-core";

import { PresenceIndicators } from "../PresenceIndicators";

describe("PresenceIndicators", () => {
  it("renders a dot for each remote participant", () => {
    const participants: OutlinePresenceParticipant[] = [
      {
        clientId: 1,
        userId: "user-local",
        color: "#ff0000",
        displayName: "Local",
        focusEdgeId: null,
        isLocal: true
      },
      {
        clientId: 2,
        userId: "user-remote-1",
        color: "#00ff00",
        displayName: "Remote One",
        focusEdgeId: null,
        isLocal: false
      },
      {
        clientId: 3,
        userId: "user-remote-2",
        color: "#0000ff",
        displayName: "Remote Two",
        focusEdgeId: null,
        isLocal: false
      }
    ];

    const { container, getByLabelText } = render(
      <PresenceIndicators participants={participants} />
    );

    expect(getByLabelText("Also viewing: Remote One, Remote Two")).toBeTruthy();
    const indicators = container.querySelectorAll('[data-outline-presence-indicator="true"]');
    expect(indicators).toHaveLength(2);
    expect((indicators[0] as HTMLElement).style.backgroundColor).toBe("#00ff00");
    expect((indicators[1] as HTMLElement).style.backgroundColor).toBe("#0000ff");
  });

  it("returns null when only the local participant is present", () => {
    const participants: OutlinePresenceParticipant[] = [
      {
        clientId: 1,
        userId: "user-local",
        color: "#ff0000",
        displayName: "Local",
        focusEdgeId: null,
        isLocal: true
      }
    ];

    const { container } = render(<PresenceIndicators participants={participants} />);
    expect(container.firstChild).toBeNull();
  });
});
