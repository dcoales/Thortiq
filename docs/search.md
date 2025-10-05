# Search & Indexing System

This document describes the search and indexing system implemented for Thortiq, providing advanced query capabilities with efficient full-text search.

## Overview

The search system consists of several key components:

- **Query Parser**: Parses search queries into an Abstract Syntax Tree (AST)
- **Index Builder**: Creates and maintains search indexes for efficient lookups
- **Query Executor**: Executes parsed queries against the search index
- **React Integration**: Provides hooks and components for UI integration
- **Session State**: Manages search state per pane

## Query Language

The search system supports a rich query language with the following features:

### Fields

Supported search fields:

- `text:` - Search in node text content
- `path:` - Search in node paths (breadcrumbs)
- `tag:` - Search in node tags
- `type:` - Search by node type (text, tagged, todo)
- `created:` - Search by creation timestamp
- `updated:` - Search by update timestamp

### Operators

- `:` - Contains search (default for text fields)
- `=` - Exact match
- `!=` - Not equal
- `>` - Greater than (for timestamps)
- `<` - Less than (for timestamps)
- `>=` - Greater than or equal
- `<=` - Less than or equal

### Boolean Logic

- `AND` - Intersection of results
- `OR` - Union of results
- `NOT` - Exclusion of results

### Grouping

Use parentheses `()` to group expressions and control precedence.

### Special Syntax

- **Tag Shorthand**: `#tagName` is equivalent to `tag:tagName`
- **Quoted Strings**: `"exact phrase"` for exact phrase matching
- **Case Insensitive**: All text comparisons are case-insensitive

## Query Examples

### Basic Text Search
```
hello
text:hello
"hello world"
```

### Tag Search
```
#important
tag:important
tag:important AND tag:urgent
```

### Boolean Combinations
```
text:hello AND tag:important
text:hello OR text:world
NOT text:hello
(text:hello OR text:world) AND tag:important
```

### Date Queries
```
created:>2024-01-01
updated:<2024-12-31
created:[2024-01-01..2024-12-31]
```

### Complex Queries
```
(text:meeting OR text:call) AND (tag:work OR tag:important) AND created:>2024-01-01
NOT tag:archived AND (text:project OR path:projects)
```

## Architecture

### Search Index

The search index is built using efficient data structures:

```typescript
interface SearchIndex {
  textIndex: Map<string, Set<NodeId>>;     // Token -> NodeIds
  pathIndex: Map<string, Set<NodeId>>;     // Path segment -> NodeIds  
  tagIndex: Map<string, Set<NodeId>>;      // Tag -> NodeIds
  typeIndex: Map<string, Set<NodeId>>;     // Type -> NodeIds
  createdIndex: Map<number, Set<NodeId>>;  // Timestamp -> NodeIds
  updatedIndex: Map<number, Set<NodeId>>;  // Timestamp -> NodeIds
  version: number;                         // Cache invalidation
}
```

### Index Building

The index builder:

1. **Tokenizes text** by splitting on whitespace and converting to lowercase
2. **Indexes paths** by extracting path segments from node hierarchies
3. **Indexes metadata** including tags, types, and timestamps
4. **Supports incremental updates** to avoid rebuilding on every change
5. **Debounces updates** (250ms) for performance

### Query Execution

The query executor:

1. **Parses queries** into AST structures
2. **Executes field queries** against appropriate indexes
3. **Applies boolean logic** (AND/OR/NOT) to combine results
4. **Handles grouping** with proper precedence
5. **Returns sorted results** by relevance score

## Performance Characteristics

### Index Building
- **Time Complexity**: O(n) where n is the number of nodes
- **Space Complexity**: O(n) for text tokens, O(log n) for other fields
- **Update Strategy**: Incremental updates for non-structural changes

### Query Execution
- **Time Complexity**: O(log n) for simple queries, O(n) for complex boolean logic
- **Memory Usage**: Minimal - uses existing index structures
- **Caching**: Index is memoized and rebuilt only when snapshot changes

### Scalability
- **Supports**: 100,000+ nodes efficiently
- **Debouncing**: Prevents excessive rebuilds during rapid edits
- **Virtualization**: Compatible with TanStack Virtual for large result sets

## React Integration

### Hooks

```typescript
// Get search index (memoized and debounced)
const searchIndex = useSearchIndex();

// Manage search state for a pane
const searchQuery = useSearchQuery(paneId);

// Get search commands
const searchCommands = useSearchCommands(paneId);

// Get search results with metadata
const searchResults = useSearchResults(paneId);
```

### Components

```typescript
// Search input component
<SearchInput paneId={paneId} placeholder="Search..." />

// Updated header with search toggle
<OutlineHeader paneId={paneId} {...otherProps} />
```

## Session State Integration

Search state is managed per pane:

```typescript
interface SessionPaneState {
  searchQuery?: string;                    // Raw query string
  searchActive: boolean;                  // Whether search UI is showing
  searchResultNodeIds?: readonly NodeId[]; // Matched nodes
  searchFrozen?: boolean;                  // If true, editing doesn't refilter
}
```

### Commands

```typescript
// Execute search and store results
setSearchQuery(sessionStore, paneId, query, resultNodeIds);

// Toggle search UI visibility
toggleSearchActive(sessionStore, paneId);

// Freeze search results during editing
freezeSearchResults(sessionStore, paneId);

// Clear search state
clearSearch(sessionStore, paneId);
```

## Search Results Display

### Hierarchy Preservation

Search results maintain the outline hierarchy:

- **Ancestors included**: All ancestor nodes of matches are shown
- **Partial filtering**: Nodes with some children hidden show special indicators
- **Visual cues**: 45-degree arrows and grey bullet circles for partially filtered nodes

### Result Freezing

Per the specification, search results are frozen during editing:

- **No live filtering**: Results don't update as user edits nodes
- **Manual refresh**: User must press Enter to re-execute search
- **New nodes visible**: Nodes created during search remain visible

## Testing Strategy

### Unit Tests

- **Query Parser**: All syntax variations and error cases
- **Index Builder**: Index creation, updates, and edge cases
- **Query Executor**: Boolean logic, field matching, and performance
- **Session Commands**: State management and persistence

### Integration Tests

- **React Hooks**: Index lifecycle and state synchronization
- **UI Components**: User interactions and error handling
- **End-to-End**: Complete search workflows

### Performance Tests

- **Large datasets**: 100,000+ node performance
- **Rapid updates**: Debouncing effectiveness
- **Memory usage**: Index size and cleanup

## Extension Points

### Adding New Fields

To add a new searchable field:

1. **Extend SearchField type** in `types.ts`
2. **Update query parser** to recognize the field
3. **Add index building** in `indexBuilder.ts`
4. **Implement matching logic** in `queryExecutor.ts`
5. **Add tests** for the new field

### Custom Operators

To add new operators:

1. **Extend SearchOperator type** in `types.ts`
2. **Update parser** to handle the operator
3. **Implement execution logic** in `queryExecutor.ts`
4. **Add comprehensive tests**

### Performance Optimizations

- **Index compression**: Use more efficient data structures
- **Lazy loading**: Load indexes on-demand for large datasets
- **Caching**: Cache frequently used query results
- **Background indexing**: Build indexes in web workers

## Error Handling

The system provides comprehensive error handling:

- **Parse Errors**: Clear messages for invalid syntax
- **Execution Errors**: Graceful handling of index issues
- **UI Errors**: User-friendly error display in search input
- **Fallback Behavior**: Graceful degradation when search fails

## Future Enhancements

Potential improvements:

- **Fuzzy matching**: Handle typos and approximate matches
- **Search suggestions**: Auto-complete for queries
- **Saved searches**: Store and reuse common queries
- **Search analytics**: Track popular searches and patterns
- **Advanced operators**: Regex, wildcards, proximity search
- **Multi-language**: Support for different languages and scripts
