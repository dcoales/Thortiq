import type {EdgeId, EdgeRecord, NodeId} from '../types';
import {ProseMirrorNodeEditor} from '../richtext/ProseMirrorNodeEditor';

/**
 * NodeEditor wires shared outline props into the active rich text editor.
 * The component stays thin so future refactors can swap editor internals.
 */
export interface NodeEditorProps {
  readonly nodeId: NodeId;
  readonly edge: EdgeRecord | null;
  readonly className?: string;
  readonly onNodeCreated?: (details: {nodeId: NodeId; edgeId: EdgeId}) => void;
  readonly onTabCommand?: (
    edge: EdgeRecord | null,
    direction: 'indent' | 'outdent',
    caretPosition: number | null
  ) => boolean;
  readonly onBackspaceAtStart?: (edge: EdgeRecord) => boolean;
  readonly onFocusEdge?: (edgeId: EdgeId | null) => void;
  readonly focusDirective?: {position: number; requestId: number} | null;
  readonly onFocusDirectiveComplete?: (requestId: number) => void;
}

export const NodeEditor = (props: NodeEditorProps) => <ProseMirrorNodeEditor {...props} />;
