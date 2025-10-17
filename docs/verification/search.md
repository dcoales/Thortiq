# Search Verification Checklist

These manual checks confirm the collaborative search experience remains stable after code changes. Run through them in a seeded outline with at least a few nested nodes and wiki links.

1. **Header Search Toggle** – Click the header search icon, enter a query (`target`), press Enter, and confirm only matching nodes plus their ancestors render. Clear the query with the × button and ensure the breadcrumb bar returns without layout shifts.
2. **Navigation Clearing** – Re-run the search, then follow a breadcrumb, click Back/Forward, and activate a wiki link inside the results. Each navigation action should restore the default outline view and hide the search input.
3. **Result Persistence** – With a query applied, edit a matching node’s text so it no longer satisfies the criteria. The row should stay visible until you submit the search again; on re-submission it disappears.
4. **Appending in Search Mode** – While search results are active, hit Enter to create a new child. The newly created row should appear immediately even if it does not match the query, and the virtual list should not jump.
5. **Virtualizer Health** – Submit a query that dramatically reduces row heights (e.g., showing only single-line notes after previously expanded branches). Scroll through results and confirm there are no gaps, overlaps, or stale measurements.

Document any deviations or UX regressions before shipping.***
