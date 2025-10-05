This document constrains how changes are made so the system stays stable.  Before declaring that a task is finished check all coding changes against the following rules:

## Core Stability Rules

1. **Keep the repo buildable.** Before finishing a task: `npm run lint && npm run typecheck && npm test`.
2. **Add concise comments** - Explain complex logic, edge cases, and architectural decisions.
3. **Never mutate text/structure outside Yjs transactions.** All document changes must go through `withTransaction()` helpers.
4. **No DOM surgery while typing** otherwise the cursor may get lost.
5. **Mirrors are edges.** Same `nodeId` may appear in multiple parents. Store edge‑local state (e.g., `collapsed`) on the **edge**.
6. **Unified history.** A single `UndoManager` tracks structural, formatting and text changes. Remote changes must not enter local undo history.
7. **Virtualize rows** to maintain performance. A tree may contain 100's of thousands of nodes. Avoid heavy computations on every update; debounce non‑critical indexing.

## Architecture & Design Principles

8. **SOLID principles.** Do not mix view logic, data ops, and side‑effects in the same file. Consider the Layering Overview in docs/architecture/thortiq_layers.md when structuring code.
9. **Composition over inheritance.** Favor small composable functions/components and hooks. Inheritance only when a true subtype relationship is clear and stable.
10. **DRY, but not WET.** Extract common utilities where appropriate and try to reuse as much code as sensible across web, desktop and mobile applications.
11. **Stable IDs.** Use UUID/ULID generators; never rely on array index for identity in app state.
12. **TypeScript not Javascript.** No `any` unless separately justified with a TODO including owner/date.

## Multi-Platform Architecture

13. **Shared-first architecture.** Prioritize reusable domain logic in shared packages (e.g. `packages/client-core`) and keep `apps/<platform>` code as thin adapters; extract common code before duplicating.
14. **Platform adapters.** Wrap platform-specific APIs behind explicit interfaces so shared modules depend on stable contracts; document new adapters in `docs/architecture` and link the doc in your PR/task notes.
15. **Explain intent.** Add brief module-level comments describing responsibilities, key inputs/outputs, and invariants so future maintainers (human or LLM) can navigate without digging through history.

## Testing & Quality

16. **Test shared code.** Ship unit tests for reusable utilities and update integration tests when shared APIs change; breaking shared contracts requires updating dependent platform tests plus a changelog note.
17. **Keep logic composable.** Prefer small, pure helpers and hooks; avoid mixing side-effects, view logic, and data operations in a single module to preserve SOLID and ease reuse.
18. **Document structural shifts.** When introducing significant architectural or protocol changes, include an architecture sketch (Markdown/diagram) under `docs/architecture` and reference it here for future agents.
19. **Full-stack editor tests.** When adding or updating rich text/editor tests, mimic real frontend interaction flows (focus/blur, command dispatch, async commits) rather than shortcutting with direct state mutation so regressions like cursor jumps surface in CI.

## ProseMirror Integration Rules

20. **Single editor instance.** Only mount one ProseMirror instance on the active node. Other nodes display as read-only HTML.
21. **Seamless switching.** Entering/leaving edit mode must display identical text (no flicker, no vertical/horizontal shifts) regardless of font, spacing or browser.
22. **Visual parity.** HTML view and rich editor share identical typography, whitespace, wrapping, leading and trailing space handling.
23. **Virtualization compatibility.** Do not break TanStack Virtual row measurement or proper virtualisation.
24. **Yjs integration.** Editor must drive undo/redo via the Yjs flow, preserving per-node undo order.
25. **Performance optimization.** Keep Node IDs stable and avoid frame-timing hacks that depend on single RAF; prefer deterministic sequencing.

## Real-time Collaboration Rules

26. **Conflict-free operations.** All structural changes (move, indent, delete) must be implemented as CRDT operations that commute correctly.
27. **Awareness integration.** Cursor positions, selections, and presence indicators must sync across clients without causing conflicts.
28. **Offline-first design.** All operations must work offline and sync when connectivity returns.
29. **Transaction boundaries.** Group related operations into single transactions to maintain consistency and performance.

## Performance & Scalability

30. **Debounce non-critical operations.** Search indexing, presence updates, and UI state changes should be debounced to avoid performance degradation.
31. **Lazy loading.** Load node content and metadata on-demand, especially for large trees.
32. **Memory management.** Properly dispose of event listeners, observers, and subscriptions to prevent memory leaks.
33. **Efficient data structures.** Use appropriate data structures for different operations (Maps for lookups, Arrays for ordered data).

## User Experience Rules

34. **Keyboard-first design.** All operations should be accessible via keyboard shortcuts with consistent behavior across platforms.
35. **Drag and drop precision.** Implement precise drop zones and visual feedback for drag operations.
36. **Focus management.** Maintain proper focus flow during structural changes and editor transitions.
37. **Error handling.** Provide clear error messages and graceful degradation for network issues.

## Development Workflow

38. **Node modules separate.** Keep node modules separate from other code so that I can easily zip up a folder with the source code for either the client applications or the server application separately without including node modules in either zip file.
39. **Incremental changes.** Make small, focused changes that can be easily reviewed and tested.
40. **Backward compatibility.** Ensure changes don't break existing functionality or data formats.

## Implementation Patterns & Examples

### Yjs Transaction Pattern
```typescript
// ✅ Correct: All mutations in transactions
const result = withTransaction(outline, (transaction) => {
  outline.nodes.set(nodeId, nodeData);
  outline.edges.set(edgeId, edgeData);
  return "success";
});

// ❌ Wrong: Direct mutations outside transactions
outline.nodes.set(nodeId, nodeData); // This breaks undo/redo
```

### ProseMirror Integration Pattern
```typescript
// ✅ Correct: Single editor instance with node switching
const editor = createCollaborativeEditor({
  container,
  outline,
  awareness,
  undoManager,
  localOrigin,
  nodeId: activeNodeId
});

// Switch nodes without recreating editor
editor.setNode(newNodeId);

// ❌ Wrong: Multiple editor instances
const editors = nodes.map(node => createCollaborativeEditor({...}));
```

### Virtualization Pattern
```typescript
// ✅ Correct: Use TanStack Virtual with proper row measurement
const virtualizer = useVirtualizer({
  count: rows.length,
  getScrollElement: () => scrollElementRef.current,
  estimateSize: (index) => getRowHeight(rows[index]),
  overscan: 5
});

// ❌ Wrong: Rendering all nodes
return rows.map(row => <RowComponent key={row.id} {...row} />);
```

### Platform Adapter Pattern
```typescript
// ✅ Correct: Platform-specific implementations behind interfaces
interface StorageAdapter {
  save(key: string, data: unknown): Promise<void>;
  load(key: string): Promise<unknown>;
}

// Web implementation
class WebStorageAdapter implements StorageAdapter {
  async save(key: string, data: unknown) {
    localStorage.setItem(key, JSON.stringify(data));
  }
}

// Mobile implementation  
class MobileStorageAdapter implements StorageAdapter {
  async save(key: string, data: unknown) {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  }
}
```

### Error Handling Pattern
```typescript
// ✅ Correct: Graceful degradation with user feedback
try {
  await syncManager.connect();
} catch (error) {
  console.error('Sync failed:', error);
  showUserMessage('Working offline - changes will sync when connection returns');
  // Continue with offline functionality
}
```

### Testing Pattern
```typescript
// ✅ Correct: Test real interaction flows
it('handles node editing with cursor preservation', async () => {
  const editor = createCollaborativeEditor({...});
  
  // Simulate real user interaction
  editor.view.dispatch(editor.view.state.tr.insertText('Hello'));
  editor.view.dispatch(editor.view.state.tr.insertText(' World'));
  
  expect(getNodeText(outline, nodeId)).toBe('Hello World');
  
  // Test undo preserves cursor position
  expect(undoCommand(editor.view.state, editor.view.dispatch)).toBe(true);
  expect(getNodeText(outline, nodeId)).toBe('Hello');
});
```

## Common Pitfalls to Avoid

- **Don't** create multiple ProseMirror instances for different nodes
- **Don't** mutate Yjs data structures outside transactions
- **Don't** break virtualization by rendering all nodes
- **Don't** mix platform-specific code in shared packages
- **Don't** forget to dispose of event listeners and observers
- **Don't** rely on array indices for node identity
- **Don't** implement drag/drop without precise drop zones
- **Don't** break undo/redo by bypassing the unified UndoManager
