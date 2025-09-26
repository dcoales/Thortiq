# Rich Text Editor Reimplementation Plan

_Rebuild starting from commit `2079ccb7a278b9e8ecb14107927a16a0c543281d`_

## Goals & Success Criteria

1. **Seamless Switching** � Entering and leaving edit mode must display identical text (no flicker, no vertical/horizontal shifts) regardless of font, spacing or browser. First click immediately activates the rich editor and positions the caret where the user clicked.
2. **Visual Parity** � HTML view and rich editor share identical typography, whitespace, wrapping, leading and trailing space handling. Long lines wrap naturally without affecting TanStack Virtual�s height calculations.
3. **Behavioural Parity** � `Enter`, `Backspace`, selection drag, and undo/redo behave exactly as in commit `2079ccb7a278b9e8ecb14107927a16a0c543281d`.
4. **Collaboration** � Rich edits synchronise across clients through Yjs exactly as before.

## Constraints & Guardrails

- Do not break existing node selection semantics or TanStack Virtual row measurement.
- No HTML mutation outside Yjs transactions (AGENTS.md rule).
- Editor must drive undo/redo via the existing `CommandBus`/Yjs flow, preserving per-node undo order.
- Keep Node IDs stable and avoid frame-timing hacks that depend on single RAF; prefer deterministic sequencing.
- Rich editor flag must be off by default until final QA passes; plan includes manual re-enable step.

## High-Level Architecture

### 1. Composition

- Continue rendering HTML by default. When a row is active, layer the rich editor **on top** of the static HTML.
- Static HTML remains visible until the editor reports ready; only then hide it (via `visibility: hidden`) to eliminate flicker.
- Both layers consume a shared typography token set (`thq-node-text` class) with CSS modules defining:
  - `font-family`, `font-size`, `font-weight`, `line-height`, `white-space: pre-wrap`, `word-break: break-word`, `letter-spacing` and colour palette.

### 2. Caret Mapping

- On pointer down (before the editor mounts):
  1. Use DOM APIs (`caretRangeFromPoint`/`caretPositionFromPoint`) on the static HTML container to compute a text offset.
  2. Store `{offset, requestId}` and hand it to the rich editor overlay.
  3. Overlay applies the selection after it mounts and imports HTML (double `requestAnimationFrame`).
- Pointer coordinates are used only as a fallback when the static layer cannot produce an offset.

### 3. Lexical + Yjs Integration

- Use Lexical with a stable `IRichTextAdapter` contract.
- Bind Lexical to a Yjs `XmlText` sidecar per node.
  - Local edits: wrap Lexical transactions with `doc.transact(..., LOCAL_ORIGIN)` so undo manager captures them.
  - Remote edits: sync via Yjs observer; ignore events with `origin === LOCAL_ORIGIN` to prevent loops.
- `onChange` returns both HTML and plain text; only persist when HTML differs from stored node HTML.

### 4. Virtualization & Auto-sizing

- Rich editor overlay content lives inside the same row container measured by TanStack.
- NodeEditor (textarea fallback) and rich editor overlay both auto-size by setting `height: auto` then `height = scrollHeight`.
- No fixed heights; rely on content-driven sizing so long lines increase row height naturally.

## Behaviour Specifications

### Enter Key (derived from commit `2079ccb7a278b9e8ecb14107927a16a0c543281d`)

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

## Step-by-Step Plan

### Phase 0 � Reset to Baseline

1. Checkout commit `2079ccb7a278b9e8ecb14107927a16a0c543281d` into a feature branch.
2. Copy current regression tests (selection, virtualization, backspace/enter tests) for later comparison.

### Phase 1 � Shared Typography & CSS Canonicalisation

1. Create `packages/client-core/src/styles/typography.css` defining `.thq-node-text` metrics (font, spacing, white-space).
2. Apply the class to:
   - Static HTML renderers.
   - NodeEditor `<textarea>`.
   - Rich editor container.
3. Add snapshot test to ensure HTML vs Lexical export produce identical DOM (string compare after normalising whitespace).

### Phase 2 � Adapter Contract & Infrastructure

1. Reintroduce `IRichTextAdapter` interface and tests.
2. Implement stub adapter (contentEditable) to keep behaviour while infrastructure is built.
3. Build command-bus guard: skip persistence when html matches stored value.
4. Add integration test verifying caret doesn�t move on consecutive onChange events.

### Phase 3 � Overlay Activation Flow

1. Implement static underlay + editor overlay composition:
   - Underlay visible until overlay signals ready.
   - Use `visibility` swap, not `display`, to retain layout.
2. Add pointer-down handler collecting text offset via helpers (added earlier).
3. Provide `selectAt` directive to adapter; update overlay to apply selection after double RAF.
4. Add tests:
   - Synthetic click returns caret offset matching text index.
   - Ensure no DOM flicker (underlay remains visible between pointer down and overlay ready).

### Phase 4 � Lexical Integration

1. Replace stub adapter with Lexical + minimal plugins:
   - Html import/export plugin (DOM parser + generator).
   - WikiLink node (later phase).
2. Bind to `Y.XmlText` sidecar; mirror html changes both ways.
3. Ensure local transactions emit with `LOCAL_ORIGIN`; remote ones (provider / doc changes) use default origin.
4. Unit tests verifying:
   - Local edits update `XmlText` with origin `LOCAL_ORIGIN`.
   - Remote edits sync into editor without disturbing caret.

### Phase 5 � Behaviour Hooks

1. Re-use existing `handleEnter`, `handleBackspaceAtStart`, `createNodeRecord` etc. from baseline component.
2. Lexical adapter must expose `getPlainText`, `getSelectionOffset` to reuse existing logic.
3. Add regression tests covering all scenarios in the behaviour tables (Enter, Backspace, merge, child creation).

### Phase 6 � Selection & Undo

1. Verify drag selection still operates on static HTML (overlay shouldn�t intercept pointer events until active).
2. Ensure rich overlay prevents selection stealing by using `pointer-events: none` on overlay until activated.
3. Undo/redo integration tests:
   - Edit node A, then node B. Undo twice => Node B changes revert first, then Node A.
   - Redo order matches baseline.

### Phase 7 � Collaboration Validation

1. Manual two-client session: ensure edits sync live.
2. Automated test using headless Yjs doc to confirm remote edits update overlay without flicker or caret jump when remote edit touches active node.

### Phase 8 � WikiLink Node & Export Parity

1. Implement Lexical `WikiLinkNode` matching `<span data-wikilink="true" data-target-node-id="...">display</span>`.
2. Import/export plugin ensures identical HTML structure as baseline.
3. Tests verifying wiki links stay clickable in HTML and inside editor.

### Phase 9 � Final Toggle & Regression Suite

1. Re-run `npm run lint && npm run typecheck && npm test`.
2. Manual QA script:
   - Click various positions (start/middle/end) on long nodes.
   - Type/backspace/enter combos, including child creation.
   - Undo/redo across nodes.
   - Drag selection across multiple nodes.
   - Remote collaboration scenario.
3. Flip `ENABLE_RICH_EDITOR = true` before merging; update tests expecting rich mode by default.

### Phase 10 � Rollout & Monitoring

1. Document behaviour & known edge cases in `docs/richtext_editor_reimplementation_plan.md` (this file) plus release notes.
2. Stage feature behind runtime flag or env toggle for production rollout (if needed).
3. Monitor telemetry (if available) for caret placement anomalies.

## Testing Checklist

- Unit: Adapter contract, html parity, caret mapping helpers.
- Integration: Enter/backspace scenarios, undo/redo, virtualization measurement, selection drag.
- E2E/manual: cross-browser (Chromium, Firefox, Safari), collaboration, long text nodes, wiki links.
- Performance: Ensure virtualization total size calculations remain stable during rapid typing.

---

**Outcome:** A deterministic, flicker-free rich text editor that matches legacy behaviour and integrates deeply with our Yjs undo/redo, while maintaining virtualization performance and collaboration fidelity.
