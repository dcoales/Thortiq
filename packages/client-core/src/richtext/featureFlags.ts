/**
 * Centralised feature flag helpers for rich text editing so the editor surface
 * can be enabled incrementally across platforms and tests without hard-wiring
 * environment checks throughout the codebase.
 */
const ENV_FLAG_KEY = 'THORTIQ_ENABLE_PROSEMIRROR';

const readBooleanEnv = (key: string): boolean => {
  if (typeof process === 'undefined') {
    return false;
  }
  const raw = process.env?.[key];
  if (!raw) {
    return false;
  }
  return raw.toLowerCase() === 'true';
};

const readGlobalFlag = (): boolean => {
  if (typeof globalThis === 'undefined') {
    return false;
  }
  const globalFlag = (globalThis as {__THORTIQ_ENABLE_PROSEMIRROR__?: unknown}).__THORTIQ_ENABLE_PROSEMIRROR__;
  return Boolean(globalFlag);
};

export const isProseMirrorEditorEnabled = (): boolean => {
  if (readBooleanEnv(ENV_FLAG_KEY)) {
    return true;
  }
  return readGlobalFlag();
};
