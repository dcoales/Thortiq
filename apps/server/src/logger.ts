export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const toStructuredLogArgs = (message: string, context?: Record<string, unknown>): [string, Record<string, unknown>] => {
  if (context && Object.keys(context).length > 0) {
    return [message, context];
  }
  return [message, {}];
};

export const createConsoleLogger = (): Logger => {
  return {
    info(message, context) {
      const [msg, ctx] = toStructuredLogArgs(message, context);
      console.info(msg, ctx);
    },
    warn(message, context) {
      const [msg, ctx] = toStructuredLogArgs(message, context);
      console.warn(msg, ctx);
    },
    error(message, context) {
      const [msg, ctx] = toStructuredLogArgs(message, context);
      console.error(msg, ctx);
    }
  };
};
