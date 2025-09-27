declare module 'y-prosemirror' {
  import type * as Y from 'yjs';
  import type {Plugin} from 'prosemirror-state';

  export interface YSyncPluginOptions {
    mapping?: Map<Y.AbstractType<unknown>, unknown>;
    colors?: Array<{light: string; dark: string}>;
    colorMapping?: Map<string, {light: string; dark: string}>;
    permanentUserData?: unknown;
    onFirstRender?: () => void;
  }

  export const ySyncPluginKey: import('prosemirror-state').PluginKey;
  export const yUndoPluginKey: import('prosemirror-state').PluginKey;
  export const yCursorPluginKey: import('prosemirror-state').PluginKey;

  export function ySyncPlugin(
    fragment: Y.XmlFragment,
    options?: YSyncPluginOptions
  ): Plugin;

  export function yUndoPlugin(params?: {trackedOrigins?: Set<unknown>}): Plugin;
  export function yCursorPlugin(): Plugin;

  export function prosemirrorToYXmlFragment(
    doc: import('prosemirror-model').Node,
    fragment?: Y.XmlFragment
  ): Y.XmlFragment;
}
