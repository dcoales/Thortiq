/**
 * Wiki types
 *
 * Pure types for wiki link markup and resolved targets. These types are used
 * by parsers and renderers only; no Yjs state is mutated here.
 */
import type {NodeId} from '../types';

export type WikiLinkId = string;

// Parsed token from plain text like [[Display|Target]] or [[Target]]
export interface WikiLinkToken {
  readonly start: number; // inclusive index in source text
  readonly end: number; // exclusive index in source text
  readonly raw: string; // original substring including brackets
  readonly display: string; // display part (defaults to target text if omitted)
  readonly targetText: string; // raw target reference text
}

// Resolved wiki link pointing to a node id
export interface WikiLinkResolved {
  readonly id: WikiLinkId;
  readonly display: string;
  readonly targetNodeId: NodeId;
}

export interface WikiLinkRenderOptions {
  readonly linkId?: WikiLinkId;
  readonly className?: string;
  readonly dataAttrs?: Readonly<Record<string, string | number | boolean>>;
}

