/**
 * Rich Text Adapter Contract
 *
 * Responsibility: Define a platform-agnostic interface for mounting and
 * controlling a rich text editor. This remains free of Yjs/DOM side-effects
 * beyond the container mount; concrete implementations handle runtime details.
 *
 * Invariants:
 * - Callers remain the sole authority for persistence. The adapter emits
 *   changes via onChange; CommandBus/Yjs handle all mutations/undo.
 * - Consumers guarantee identical typography between read-only HTML and the
 *   editor surface to avoid layout shift during click-to-edit.
 */
import type {NodeId} from '../types';

export interface AdapterPoint {
  readonly x: number; // viewport/client X in CSS pixels
  readonly y: number; // viewport/client Y in CSS pixels
}

export interface AdapterMountOptions {
  /**
   * Initial HTML to display. Implementations must render this value without
   * mutating external state. Subsequent updates should go through setHtml().
   */
  readonly initialHtml: string;
  /**
   * Apply an identical typography class used by the read-only renderer to
   * prevent visible reflow when switching to edit mode.
   */
  readonly typographyClassName?: string;
  /**
   * Invoked when a wikilink span is clicked inside the editor.
   */
  readonly onLinkClick?: (targetNodeId: NodeId) => void;
  /**
   * Optional collaboration binding. Implementations may use this to connect the
   * editor to a shared text model. The contract remains platform-agnostic by
   * typing the shared value as unknown; callers pass a handle such as a Y.Text.
   */
  readonly collab?: {
    /** Shared text model for this node (e.g., Y.Text). */
    readonly yText: unknown;
    /** Optional error callback for adapter-level failures. */
    readonly onError?: (err: unknown) => void;
  };
}

export interface InsertWikiLinkPayload {
  readonly targetNodeId: NodeId;
  readonly display: string;
}

export type Unmount = () => void;
export type Unsubscribe = () => void;

export interface IRichTextAdapter {
  /**
   * Mount editor into the provided container. Implementations should not
   * resize/reparent the container; render within its bounds.
   */
  mount(container: HTMLElement, options: AdapterMountOptions): Unmount;

  /**
   * Replace editor contents with provided HTML (no external side-effects).
   */
  setHtml(html: string): void;

  /**
   * Return current HTML representation of the editor contents.
   */
  getHtml(): string;

  /**
   * Return current plain text (for splitting/metrics and search indexing helpers).
   */
  getPlainText(): string;

  /**
   * Return caret offset within the plain text (UTF-16 code units).
   */
  getSelectionOffset(): number;

  /**
   * Focus the editor and place caret based on click coordinates.
   */
  focusAt(point: AdapterPoint): void;

  /**
   * Focus the editor and place selection at textual offset (UTF-16 code units).
   */
  setSelection(offset: number): void;

  /**
   * Subscribe to content changes. Callback supplies HTML and plain text to aid
   * callers that maintain parallel search indexes. Implementations should
   * debounce if needed to avoid excessive calls.
   */
  onChange(cb: (html: string, plainText: string) => void): Unsubscribe;

  /**
   * Insert a wikilink inline node at current selection/caret.
   */
  insertWikiLink(payload: InsertWikiLinkPayload): void;

  /**
   * Dispose any internal resources.
   */
  destroy(): void;
}
