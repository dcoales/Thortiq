import { ulid } from "ulidx";

import type {
  SecurityAlertChannel,
  SecurityAlertContext,
  SecurityAlertPayload,
  SecurityAlertPublisher,
  SecurityAlertType
} from "@thortiq/client-core";

import type { Logger } from "../logger";

export interface SecurityAlertServiceOptions {
  readonly enabled: boolean;
  readonly logger: Logger;
}

interface AlertContextInput extends SecurityAlertContext {
  readonly userId: string;
  readonly type: SecurityAlertType;
}

const now = () => Date.now();

const buildAlert = (context: AlertContextInput): SecurityAlertPayload => ({
  id: ulid(),
  userId: context.userId,
  type: context.type,
  occurredAt: now(),
  context,
  metadata: null
});

export class SecurityAlertService implements SecurityAlertPublisher {
  private readonly channels = new Set<SecurityAlertChannel>();
  private readonly enabled: boolean;
  private readonly logger: Logger;

  constructor(options: SecurityAlertServiceOptions) {
    this.enabled = options.enabled;
    this.logger = options.logger;
  }

  registerChannel(channel: SecurityAlertChannel): void {
    this.channels.add(channel);
  }

  async notify(alert: SecurityAlertPayload): Promise<void> {
    if (!this.enabled) {
      this.logger.info("Security alerts disabled; skipping notify", { type: alert.type });
      return;
    }
    for (const channel of this.channels) {
      try {
        await channel.publish(alert);
      } catch (error) {
        this.logger.warn("Security alert channel failed", {
          alertId: alert.id,
          type: alert.type,
          error: error instanceof Error ? error.message : error
        });
      }
    }
    if (this.channels.size === 0) {
      this.logger.info("Security alert emitted without channels", { alert });
    }
  }

  async notifyNewDeviceLogin(context: SecurityAlertContext & { userId: string }): Promise<void> {
    await this.notify(
      buildAlert({
        ...context,
        type: "new_device_login"
      })
    );
  }

  async notifyMfaMethodAdded(context: SecurityAlertContext & { userId: string }): Promise<void> {
    await this.notify(
      buildAlert({
        ...context,
        type: "mfa_method_added"
      })
    );
  }

  async notifyMfaMethodRemoved(context: SecurityAlertContext & { userId: string }): Promise<void> {
    await this.notify(
      buildAlert({
        ...context,
        type: "mfa_method_removed"
      })
    );
  }

  async notifySessionRevoked(context: SecurityAlertContext & { userId: string }): Promise<void> {
    await this.notify(
      buildAlert({
        ...context,
        type: "session_revoked"
      })
    );
  }
}

export class LoggingSecurityAlertChannel implements SecurityAlertChannel {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async publish(alert: SecurityAlertPayload): Promise<void> {
    this.logger.info("Security alert published", {
      id: alert.id,
      type: alert.type,
      userId: alert.userId,
      context: alert.context
    });
  }
}
