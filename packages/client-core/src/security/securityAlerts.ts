/**
 * Shared contracts for publishing security alerts across platforms. Server implementations wire
 * these interfaces to email, push, or in-app notification adapters while clients can reference the
 * same shapes when presenting alert history. Keeping the definitions close to other auth types
 * ensures SOLID boundaries without coupling platform concerns.
 */
export type SecurityAlertType =
  | "new_device_login"
  | "suspicious_login_blocked"
  | "mfa_method_added"
  | "mfa_method_removed"
  | "session_revoked";

export interface SecurityAlertContext {
  readonly deviceId?: string;
  readonly deviceDisplayName?: string;
  readonly devicePlatform?: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly sessionId?: string;
  readonly methodId?: string;
  readonly methodType?: string;
}

export interface SecurityAlertPayload {
  readonly id: string;
  readonly userId: string;
  readonly type: SecurityAlertType;
  readonly occurredAt: number;
  readonly context?: SecurityAlertContext;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export interface SecurityAlertChannel {
  publish(alert: SecurityAlertPayload): Promise<void>;
}

export interface SecurityAlertPublisher {
  notify(alert: SecurityAlertPayload): Promise<void>;
  registerChannel(channel: SecurityAlertChannel): void;
}

