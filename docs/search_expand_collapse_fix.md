# Search Result Expand/Collapse Fix

## Problem

When displaying search results, there were two critical issues:

### Issue A: Large Gaps in Results
Large gaps appeared in the search results where ancestor nodes should have been visible. This occurred because the search filtering logic was skipping ancestor nodes even though they should be shown as part of the hierarchy leading to matching nodes.

### Issue B: Hidden Matching Nodes
Some nodes that matched the search criteria were hidden under collapsed ancestor nodes (e.g., "pickle" under "Hello"). According to the spec (Section 7.4), any ancestor of a matching node should be automatically expanded in search results.

## Root Cause

The `buildSearchRows` function in `packages/client-core/src/selectors.ts` was respecting the original collapsed state of edges when rendering search results:

```typescript
// OLD CODE (incorrect)
const effectiveCollapsed = collapsedOverride.has(edgeId) || edge.collapsed;
```

This meant that:
1. If an edge was collapsed before the search, it would remain collapsed in search results
2. The recursion would stop at collapsed nodes, preventing their children from being rendered
3. Matching nodes underneath collapsed ancestors would be invisible

## Solution

Modified the collapse logic in `buildSearchRows` to **force expand** any ancestor that has visible children in the search results:

```typescript
// NEW CODE (correct)
// In search results, force expand ancestors with visible children
// Only respect user's explicit collapse override during search
const hasVisibleChildren = visibleChildren && visibleChildren.size > 0;
const hasAnyChildren = childEdgeIds.length > 0;
const effectiveCollapsed = collapsedOverride.has(edgeId) 
  ? true 
  : (hasAnyChildren && !hasVisibleChildren);
```

### Logic Breakdown

1. **`hasVisibleChildren`**: Check if this node has any children that are visible in search results (either matching nodes or ancestors of matching nodes)

2. **`hasAnyChildren`**: Check if this node has any children at all in the outline (regardless of filtering)

3. **`effectiveCollapsed`**: 
   - If the user explicitly collapsed this node during the search (`collapsedOverride.has(edgeId)`), respect that and keep it collapsed
   - Otherwise:
     - If the node has children AND none are visible → collapsed (branch with all children filtered out)
     - If the node has children AND some are visible → expanded (ancestor of match)
     - If the node has NO children → not collapsed (leaf node, including matching leaf nodes)

### Behavior

**Before Search:**
- Node "Hello" is collapsed (edge.collapsed = true)
- Node "pickle" is a child of "Hello" and not visible

**During Search for "pickle":**
- "pickle" matches the search
- "Hello" is identified as an ancestor of "pickle"
- "Hello" is automatically expanded in search results (`hasVisibleChildren = true`)
- "pickle" becomes visible

**After Search is Cleared:**
- "Hello" returns to its original collapsed state (edge.collapsed = true)
- "pickle" is hidden again
- Original collapse state is preserved because we never modified `edge.collapsed`

**User Collapses During Search:**
- If user clicks to collapse "Hello" while search is active
- The edge ID is added to `collapsedOverride`
- "Hello" stays collapsed (`collapsedOverride.has(edgeId) = true`)
- This collapse state persists after search is cleared

## Spec Compliance

This fix ensures compliance with Section 7.4 of the spec:

> Each node that matches the search results should be shown within its hierarchy i.e. all ancestor nodes should be shown

> If an ancestor is only showing some of its children (because some are filtered out by the search criteria because they don't match the criteria and have no descendants that match the criteria) then the expand contract arrow should point down 45 degrees rather than straight down and the bullet should still have the outer grey circle to show there are hidden nodes.

The fix ensures:
- ✅ All matching nodes are visible in search results
- ✅ All ancestor nodes are automatically expanded
- ✅ Original collapse state is preserved and restored when search is cleared
- ✅ User can still manually collapse/expand during search, and this state is remembered
- ✅ Partial filtering visual indicators work correctly (45° arrow, grey bullet circle)

## Files Modified

**`packages/client-core/src/selectors.ts`**
- Modified `buildSearchRows` function
- Updated collapse logic to force expand ancestors with visible children
- Preserved user's explicit collapse overrides during search

## Testing

All existing tests pass:
- ✅ `npm run typecheck` - No TypeScript errors
- ✅ `npm run lint` - No linting errors
- ✅ `npm test` - All tests pass

## AGENTS.md Compliance

- ✅ **Rule 7 (Virtualization)**: No changes to virtualization logic, only row filtering
- ✅ **Rule 8 (SOLID)**: Pure function with clear single responsibility
- ✅ **Rule 12 (TypeScript)**: No `any` types, full type safety maintained
- ✅ **Rule 36 (Focus management)**: Focus flow not affected by collapse logic changes

## Edge Cases Handled

1. **Deeply nested matches**: Ancestors at all levels are correctly expanded
2. **Multiple branches**: Only branches with matches are expanded, others remain collapsed
3. **User interaction during search**: Manual collapse/expand is respected via `collapsedOverride`
4. **Search cleared**: Original collapse state is restored from `edge.collapsed`
5. **Partially filtered nodes**: Visual indicators work correctly (already implemented)

## Visual Result

**Before Fix:**
- Large gaps where ancestor nodes were hidden
- Matching nodes invisible under collapsed ancestors
- Search results incomplete and confusing

**After Fix:**
- All matching nodes visible in their full hierarchy
- Ancestor nodes automatically expanded to show matches
- No gaps in search results
- Search results comprehensive and clear
