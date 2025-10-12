const DEVICE_ID_STORAGE_KEY = "thortiq::device-id";

const generateId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const getNavigatorPlatform = (): string => {
  if (typeof navigator === "undefined") {
    return "web";
  }
  const userAgentData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  if (userAgentData?.platform) {
    return userAgentData.platform.toLowerCase();
  }
  if (navigator.platform) {
    return navigator.platform.toLowerCase();
  }
  return "web";
};

const getBrowserLabel = (): string => {
  if (typeof navigator === "undefined") {
    return "Browser";
  }
  const ua = navigator.userAgent ?? "";
  if (ua.includes("Firefox")) {
    return "Firefox";
  }
  if (ua.includes("Edg/")) {
    return "Edge";
  }
  if (ua.includes("Chrome")) {
    return "Chrome";
  }
  if (ua.includes("Safari")) {
    return "Safari";
  }
  return "Browser";
};

export interface DeviceDescriptor {
  readonly deviceId: string;
  readonly displayName: string;
  readonly platform: string;
}

export const getDeviceDescriptor = (): DeviceDescriptor => {
  let deviceId: string | null = null;
  try {
    deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  } catch (_error) {
    deviceId = null;
  }
  if (!deviceId) {
    deviceId = generateId();
    try {
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
    } catch (_error) {
      // If storage is unavailable (e.g. private mode), continue with ephemeral ID.
    }
  }
  return {
    deviceId,
    displayName: `${getBrowserLabel()} on ${getNavigatorPlatform()}`,
    platform: getNavigatorPlatform()
  } satisfies DeviceDescriptor;
};
