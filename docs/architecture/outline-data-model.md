# Outline Data Model

The shared outline document lives in Yjs so that every client (web, desktop, mobile) can
collaborate on the same tree without conflicts. This note captures the authoritative shape of
that document and the invariants enforced by `@thortiq/client-core`.

## Collections

The root Yjs structures are created by `createOutlineDoc()`:

| Key                | Type                 | Purpose |
|--------------------|----------------------|---------|
| `nodes`            | `Y.Map<Y.Map>`       | Stable node records keyed by `NodeId`. Each record contains the node text and metadata.
| `edges`            | `Y.Map<Y.Map>`       | Edge-local state keyed by `EdgeId`. Mirrors are represented as separate edges pointing at the same `NodeId`.
| `rootEdges`        | `Y.Array<EdgeId>`    | Ordering of the top-level outline edges.
| `childEdgeMap`     | `Y.Map<Y.Array>`     | For each parent `NodeId`, a `Y.Array<EdgeId>` describing that node’s ordered children.

All mutations go through helpers that wrap the operation in `doc.transact(...)` so we never
violate the “no mutation outside Yjs transactions” rule from `AGENTS.md`.

## Node records

Each entry in `nodes` is a `Y.Map` with two stable keys:

- `text` – a `Y.Text` instance storing the node’s inline content.
- `metadata` – a `Y.Map` containing:
  - `createdAt` / `updatedAt` timestamps (milliseconds).
  - `tags` – `Y.Array<string>` of inline tags.
  - Optional styling (`color`, `backgroundColor`).
  - Optional `todo` map (`done` flag and `dueDate`).

`createNode()` initialises these fields; `setNodeText()` and `updateNodeMetadata()` keep
`updatedAt` in sync.

## Edge records

Every edge in the outline lives in the `edges` map and is keyed by a ULID `EdgeId`. The record
contains:

- `parentNodeId` – the owning parent `NodeId` (`null` for root edges).
- `childNodeId` – the `NodeId` displayed at this position.
- `collapsed` – edge-local UI state, never stored on the node.
- `mirrorOfNodeId` – when non-null, identifies the source node this edge mirrors.
- `position` – cached index synchronised with the parent’s array ordering.

Ordering is maintained by the `rootEdges` array (for top-level nodes) and the corresponding
`Y.Array` in `childEdgeMap` for every other parent.

## Invariants

- **Stable IDs:** Node and edge IDs are ULIDs so they remain globally unique and sortable.
- **Mirrors are edges:** Multiple edges may reference the same `NodeId`; UI state always lives on
the edge record.
- **No cycles:** `addEdge()` performs a breadth-first walk to ensure the proposed parent is not a
descendant of the child. Attempts to create a cycle throw `OutlineError`.
- **Transactions only:** All mutating helpers (`createNode`, `setNodeText`, `updateNodeMetadata`,
`addEdge`, etc.) call `withTransaction()` so no one can mutate the doc outside a Yjs
transaction.

## Snapshots & selectors

`createOutlineSnapshot()` converts the live Yjs structures into immutable maps/arrays that React
can consume safely. `buildOutlineForest()` (in `selectors.ts`) turns that snapshot into a nested
`OutlineTreeNode[]` for rendering or testing. Snapshots never leak Yjs references, so consumers
can memoise or serialise them freely.

## Extending the model

New structural features should:

1. Add their Yjs storage in `doc.ts`, ensuring updates are transactional.
2. Extend the `NodeMetadata` or edge records with typed fields (avoid `any`).
3. Update the snapshot helpers so downstream callers see a consistent view.
4. Document changes here so future agents understand the evolving schema.
