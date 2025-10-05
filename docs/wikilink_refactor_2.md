Implement the wikilink regression fix in Thortiq using ProseMirror/Yjs/TanStack best practices:

---

**Repo**: `/home/dacoales/projects/Thortiq`  
**Primary files**:
- `packages/editor-prosemirror/src/index.ts`
- `packages/editor-prosemirror/src/outlineKeymap.ts`
- `packages/editor-prosemirror/src/wikiLinkPlugin.ts` (reference pattern)  
- `apps/web/src/outline/ActiveNodeEditor.tsx`  
- `packages/client-react/src/outline/useOutlineSelection.ts` (understand selection adapter semantics)  
- `docs/wikilinks-refactor.md` (keep plan updated if behaviour changes substantially)

---

### Goals

1. Restore wikilink popup behaviour (filter as you type, arrow key navigation, Enter selection) without breaking collaborative sync or performance.
2. Ensure outline keymap handlers no longer force `EditorView.state.reconfigure` on every keystroke.
3. Follow “shared-first” and SOLID layering: keep plugin logic in `@thortiq/editor-prosemirror`, React glue in `ActiveNodeEditor`.

---

### Required Approach (align with ProseMirror/Yjs best practices)

- **Plugin refs (no reconfigure loops):**  
  Mirroring `wikiLinkPlugin`, teach the outline keymap plugin to read its handlers from a mutable ref so callers update handler objects without rebuilding the plugin list. Avoid `state.reconfigure` except when the handler schema truly changes.

  Concrete steps:
  - Introduce a `OutlineKeymapOptionsRef` (similar to `WikiLinkOptionsRef`) stored in the ProseMirror editor state.
  - Update `createOutlineKeymap` to accept that ref, capture it in the plugin props, and pull handlers at runtime.
  - Update `createCollaborativeEditor` to construct the plugin with the ref and expose `setOutlineKeymapOptions` that just updates the ref and, if necessary, forces minimal invalidation (e.g., `view.dispatch(state.tr.setMeta(...))` only when the plugin truly needs to update). Keep Yjs transactions untouched.

- **Stable handler objects in React:**  
  In `ActiveNodeEditor`, ensure `outlineKeymapOptions` memo depends only on primitives (`activeRow?.edgeId`, `activeRow?.hasChildren`, etc.) and the selection adapter refs. Store the actual callbacks in refs so the memo output stays reference-stable across keystrokes.

- **Undo/state integrity:**  
  Do not mutate outside Yjs transactions. Ensure the shared undo manager still tracks outline keymap commands exactly as today.

- **Testing alignment:**  
  If modifying shared packages, add/adjust unit tests (e.g., `packages/editor-prosemirror/src/index.test.ts`) to assert that:
  - Updating outline keymap handlers via the new API does not clear wiki-link state.
  - Wikilink plugin still blocks Enter/Arrow keys when active and delegates to new handlers otherwise.

- **Docs/Comments:**  
  Add concise module-level comments where new abstractions are introduced, explaining responsibilities and invariants.

---

### Validation

Before finishing, run:

```
npm run lint
npm run typecheck
npm test
```

Add targeted tests for the new behaviour if coverage is missing (e.g., a test that types `[[` plus characters, ensures the wiki plugin stays active while outline keymap handlers update).

---

### Deliverables

- Updated source files with the shared-ref based outline keymap plugin and stable React wiring.
- Tests demonstrating the fix.
- Brief note in `docs/wikilinks-refactor.md` if architectural responsibilities shift.

Maintain ASCII, respect existing formatting/style, and avoid DOM mutation outside ProseMirror transactions.
