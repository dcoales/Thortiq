/**
 * Renders a compact inline stack of remote collaborators for an outline row.
 * Consumers supply the presence participants returned from shared presence hooks.
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";

import type { OutlinePresenceParticipant } from "@thortiq/client-core";

export interface PresenceIndicatorsProps {
  readonly participants: readonly OutlinePresenceParticipant[];
}

export const PresenceIndicators = ({
  participants
}: PresenceIndicatorsProps): JSX.Element | null => {
  const remoteParticipants = useMemo(
    () => participants.filter((participant) => !participant.isLocal),
    [participants]
  );

  if (remoteParticipants.length === 0) {
    return null;
  }

  const label = remoteParticipants.map((participant) => participant.displayName).join(", ");

  return (
    <span
      style={styles.stack}
      data-outline-presence="true"
      aria-label={`Also viewing: ${label}`}
    >
      {remoteParticipants.map((participant) => (
        <span
          key={`presence-${participant.clientId}`}
          style={{ ...styles.dot, backgroundColor: participant.color }}
          title={`${participant.displayName} is viewing this node`}
          data-outline-presence-indicator="true"
        />
      ))}
    </span>
  );
};

const styles: Record<"stack" | "dot", CSSProperties> = {
  stack: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    marginLeft: "0.5rem",
    textDecoration: "none"
  },
  dot: {
    display: "inline-flex",
    width: "0.6rem",
    height: "0.6rem",
    borderRadius: "9999px",
    border: "2px solid #ffffff",
    boxShadow: "0 0 0 1px rgba(17, 24, 39, 0.08)"
  }
};
