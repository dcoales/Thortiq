const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

const readEnv = (key: string): string | undefined => {
  const value = (import.meta.env?.[key] as string | undefined) ?? undefined;
  return value && value.length > 0 ? value : undefined;
};

let scriptPromise: Promise<void> | null = null;

const loadGoogleScript = (): Promise<void> => {
  if (scriptPromise) {
    return scriptPromise;
  }
  scriptPromise = new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("Google Identity Service requires a browser environment"));
      return;
    }
    if (document.querySelector(`script[src="${GOOGLE_SCRIPT_SRC}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity script"));
    document.head.appendChild(script);
  });
  return scriptPromise;
};

interface GoogleCredentialResponse {
  readonly credential: string;
}

interface PromptMomentNotificationLike {
  readonly isDismissedMoment?: () => boolean;
  readonly isSkippedMoment?: () => boolean;
}

const isDismissed = (notification: PromptMomentNotificationLike): boolean => {
  return Boolean(notification.isDismissedMoment?.());
};

const isSkipped = (notification: PromptMomentNotificationLike): boolean => {
  return Boolean(notification.isSkippedMoment?.());
};

export const requestGoogleIdToken = async (): Promise<string> => {
  const clientId = readEnv("VITE_GOOGLE_CLIENT_ID");
  if (!clientId) {
    throw new Error("VITE_GOOGLE_CLIENT_ID is not configured");
  }
  await loadGoogleScript();
  const googleApi = (window as unknown as { google?: { accounts?: { id?: unknown } } }).google;
  if (!googleApi?.accounts?.id || typeof googleApi.accounts.id !== "object") {
    throw new Error("Google Identity API is unavailable");
  }

  const accountsId = googleApi.accounts.id as {
    initialize(config: { client_id: string; callback: (response: GoogleCredentialResponse) => void }): void;
    prompt(callback: (notification: PromptMomentNotificationLike) => void): void;
    cancel(): void;
  };

  return await new Promise<string>((resolve, reject) => {
    let resolved = false;
    const cleanup = () => {
      accountsId.cancel();
    };

    const callback = (response: GoogleCredentialResponse) => {
      resolved = true;
      cleanup();
      resolve(response.credential);
    };

    accountsId.initialize({
      client_id: clientId,
      callback
    });

    accountsId.prompt((notification) => {
      if (resolved) {
        return;
      }
      if (isDismissed(notification) || isSkipped(notification)) {
        cleanup();
        reject(new Error("Google sign-in was cancelled"));
      }
    });
  });
};
