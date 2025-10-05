# Thortiq Search & Pane Requirements Review

**Review Date:** February 2025  
**Reviewer:** Codex (GPT-5)  
**Scope:** Cross-check of `docs/thortiq_spec.md` search/pane requirements versus current implementation, with emphasis on performance and architectural risks.

## Summary
- A solid baseline for collaborative outlining exists, but several **spec-mandated features are still absent** (notably multi-pane/task surfaces and richer search semantics).
- The current search stack **rebuilds indexes on every query** and walks the entire tree repeatedly, which will not scale to the 100k-node outlines called out in the spec.
- Tag interactions and platform adapters remain skeletal, leaving important UX expectations unmet.

## Critical Gaps

1. **Multi-pane & Tasks surfaces missing**  
   - Spec §6–§9 requires pane creation, cross-pane navigation, and a dedicated Tasks pane; the web app still renders a single outline pane and no task aggregates.  
   - Evidence: `apps/web/src/App.tsx:1-27` mounts only `<OutlineView paneId="outline" />` with no pane manager or tasks view.  
   - Impact: Users cannot follow spec workflows (shift/ctrl click to open in adjacent panes, task review, pane resizing), blocking core product scenarios.

2. **Search language coverage incomplete**  
   - Phrase queries (`"exact phrase"`) devolve into token-level contains checks because indexing splits on whitespace only (`packages/client-core/src/search/indexBuilder.ts:242-246`), so multi-word literals never match as a unit.  
   - Relational operators are ignored for string fields: `getTextMatches` handles only `:, =, !=` (`packages/client-core/src/search/queryExecutor.ts:245-259`), leaving spec-required `>, <, >=, <=` unsupported.  
   - Date ranges like `created:[2024-01-01..2024-12-31]` cannot parse because `parseTimestamp` expects a single scalar and rejects bracketed syntax (`packages/client-core/src/search/queryExecutor.ts:324-337`).  
   - Impact: Advanced query language advertised in §7.2 does not function, leading to user-visible bugs.

3. **Search indexing and execution scale poorly**  
   - Every search rebuilds a full-text index from scratch (`packages/client-react/src/outline/hooks/useSearchCommands.ts:54-63`) even though an incremental `updateSearchIndex` exists; this is O(N) per keystroke on large documents.  
   - `includeAncestors` repeatedly scans all edges to walk parent chains (`packages/client-core/src/search/queryExecutor.ts:421-447`), yielding O(N²) behavior when many matches share deep ancestry.  
   - Impact: Violates spec goal of “high performance” for 100k-node outlines; search latency will spike into hundreds of milliseconds or worse.

## High-Priority Concerns

4. **Tag quick-filters not wired up**  
   - Spec §8 expects clickable tag pills; the schema only defines a `wikilink` mark (`packages/editor-prosemirror/src/schema.ts:1-35`), and the static renderer handles wiki marks exclusively (`packages/client-react/src/outline/components/OutlineRowView.tsx:289-305`).  
   - Without a `tag` mark and click handlers, users cannot trigger pane-local tag filters as designed.

5. **Desktop/Mobile adapters are stubs**  
   - React Native/Electron surfaces are required per §1.1, yet the current adapters export persistence helpers only (`apps/mobile/src/index.ts:1-2`, `apps/desktop/src/index.ts:1-2`).  
   - No UI layer or platform-specific shell exists, so multi-platform deliverables remain unimplemented.

6. **Search session updates allocate aggressively**  
   - `setSearchQuery` compares previous results with `JSON.stringify(...)` on every invocation (`packages/sync-core/src/sessionStore/commands.ts:164-176`), copying entire ID arrays.  
   - With large result sets this becomes a hotspot; a shallow reference check or length/hash tracking would avoid repeated O(N) serialization.

## Recommendations
- Prioritise multi-pane/task feature work to unblock spec-critical workflows before layering additional polish.
- Rework search indexing to maintain an incremental structure (reuse `updateSearchIndex`) and cache ancestor chains keyed by child → parent to avoid repeated full-map scans.
- Extend the parsing/exec pipeline to honour phrase literals, relational operators, and range syntax; add parser tests covering the §7.2 examples.
- Introduce `tag` marks plus click handlers that call the existing quick-filter plumbing so panes react to tag chips.
- Flesh out platform adapters with thin React Native/Electron shells to validate the shared-first architecture and surface platform regressions early.
- Replace `JSON.stringify` equality checks with structural comparisons (length + element-by-element) or stable version counters to keep search updates O(1).
