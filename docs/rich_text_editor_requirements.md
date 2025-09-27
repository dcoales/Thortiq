# Rich Text Editor Requirements
## Goals & Success Criteria

1. **Seamless Switching** � Entering and leaving edit mode must display identical text (no flicker, no vertical/horizontal shifts) regardless of font, spacing or browser. First click immediately activates the rich editor and positions the caret where the user clicked.
2. **Visual Parity** � HTML view and rich editor share identical typography, whitespace, wrapping, leading and trailing space handling. Long lines wrap naturally without affecting TanStack Virtual�s height calculations.
3. **Behavioural Parity** � `Enter`, `Backspace`, selection drag, and undo/redo behave exactly as is.
4. **Collaboration** � Rich edits synchronise across clients through Yjs exactly as before.

## Constraints & Guardrails

- Do not break existing node selection semantics
- Do not break TanStack Virtual row measurement or proper virtualisation.
- No HTML mutation outside Yjs transactions (AGENTS.md rule).
- Editor must drive undo/redo via the existing `CommandBus`/Yjs flow, preserving per-node undo order.
- Keep Node IDs stable and avoid frame-timing hacks that depend on single RAF; prefer deterministic sequencing.

## Behaviour Specifications

### Enter Key

- Let `plain` be node text, `pos` caret offset, `edge` the current edge, `children` the child edges.

| Scenario                                                                            | Behaviour                                                                                                    |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Shift+Enter` or with modifier                                                      | Insert newline at caret (no structural change).                                                              |
| Caret at end (`pos === plain.length`) and node has visible children (not collapsed) | Create first child node (empty) and focus new child.                                                         |
| Caret at end, no visible children                                                   | Create sibling below current node.                                                                           |
| Caret at start & plain empty                                                        | If node has visible children, create first child; else create sibling below; focus new node.                 |
| Caret at start & plain non-empty                                                    | Split node: create sibling above (same parent) with caret at new node start.                                 |
| Caret in middle                                                                     | Split node into two nodes: current node keeps`before`, new sibling gets `after` with caret at new node start |

### Backspace (same baseline)


| Scenario                          | Behaviour                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| Selection exists                  | Delete selection within node only.                                                      |
| Caret not at start                | Delete previous character (within node).                                                |
| Caret at start and node empty     | Merge into previous visible sibling or parent, as per existing command-bus merge rules. |
| Caret at start and node non-empty | Merge text into previous sibling (existing behaviour).                                  |
| Node is first child               | When merged, caret ends in parent node per legacy behaviour.                            |


---

**Outcome:** A deterministic, flicker-free rich text editor that matches legacy behaviour and integrates deeply with our Yjs undo/redo, while maintaining virtualization performance and collaboration fidelity.
