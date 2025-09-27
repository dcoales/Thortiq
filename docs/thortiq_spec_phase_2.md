

---

## 4) Advanced Editing
### 4.1 Outline Navigation 
#### 4.1.1 Focus Node
At present the outline shows all nodes giving the appearance of multiple root nodes each of which can have children.  When all nodes are shown, no specific node is the focused node.  In essence the document itself is the focus node.

However, If the user clicks on the bullet of a node then that node becomes the focus node and the outline pane only shows that node and its children.  

The focus node will be shown as a header at the top of the outline pane without the expand collapse icon (it will always show all its children when focused).

The immediate children of the focus node will show immediately under the header without indentation.

Guidelines and drag and drop should still work as normal after a node is focused so we need to take into account that the ancestors of the focus node will not be displayed so the drop zones and guidelines for those ancestors will not be drawn.  The guideline sections and drop zones should still correctly refer to their associated nodes though.


The outline pane will have a header area across the top which will show the breadcrumb path to the focus node. The user will be able to click on any node in the breadcrumb to change the focus to that node.  If the breadcrumb is too long to fit in the header area than a subset of the path before the last node will be replaced with ellipses so that the path will fit. Ideally, we will also always try to show the first node of the path. 
 The last node should always be visible but if it is impossible to show the last node in its entirety even with some of the path hidden behind ellipses then it can be truncated with ellipses too.

If a subset of the path before the last node is replaced with ellipses the user should be able to click on the ellipses to produce a dropdown list of the nodes in the path that were replaced with ellipses.  This list should appear below the ellipses the user clicked on.  The user should also be able to click on any of the nodes in this dropdown to make that node the focused node.

#### 4.1.2 Movement History 
If the user changes the focused node then we should remember the history of what the focused node was showing before the move.  There should be forward and back arrows (< and > characters) in the top right of the outline pane.  If the user changes the focus of a pane then the back (<) arrow should highlight.  If the user clicks the back arrow then the forward (>) arrow should highlight.

The history should be specific to this pane since we may have multiple panes open in future.

#### 4.1.3 New node icon
A circle with a plus inside will show beneath the last node with indent level 0. Clicking this node will create a new node.

### 4.2 Inline triggers
#### 4.2.1 Wiki Links
Typing `[[` opens a popup **Wiki dialog** to link to another node.  The dialog presents a list of nodes from which the user can select a node.  Each node is presented with a small breadcrumb beneath it showing the location of the node.  If the node text cannot fit in the window then it is truncated with ellipses.

As the user continues typing after the `[[` trigger the Wiki dialog filters the list of nodes that contain the strings the user has typed.  If the user types several words after the `[[` trigger any nodes that contain each of the strings (not necessarily in the order entered by the user) will be presented.  The nodes will be sorted by shortest matching text first.

 By default the first node in the popup dialog will be highlighted and if the user hits return then this node will automatically be selected.  The user can also use the arrow keys to move the focus up and down the list.  When the user hits return the focused node will be selected.  The user can also click on a node in the popup to select it.

Once the user has selected a node then the square brackets and text between the brackets up to the cursor will be replaced by the text of the selected node underlined to show it is a wikilink.  The cursor will be placed after a space after the wikilink.  If there isn't a space already after the wikilink one will be added.

If the user hovers over a wikilink than a small 'edit' icon will float to the immediate right of the wikilink over the top of whatever text is to the right of the link without pushing the text over.  The user should be able to click on the edit icon and a small dialog pop up.  The dialog will show two fields: one labelled 'display text' and the other labelled 'target node'. The display text field will be editable but the target node field will be read only.  Initially the display text field will show the same text as the target node field but the user will be able to change the display text which will change the text of the wikilink that the user sees in the outline. If the user clicks the updated wikilink it will still focus the target node as before.

If the user clicks on the wikilink then the target node will become the focussed node of the outline pane and the history for the pane will be updated accordingly.

#### 4.2.2 Mirrors
##### 4.2.2.1 Creating Mirrors
Typing `((` opens a popup **Mirror dialog** very similar in behaviour to the Wikilink dialog.  The main difference is that when the user selects a node, instead of creating a wikilink to the selected node it creates a mirror.  If the cursor is on a bullet with no text then that node becomes the mirror otherwise a new sibling is created below the current node and the new sibling becomes the mirror.

A mirror is essentially another instance of the original node.  Any changes to one instance are immediately reflected in the other.  The open and closed states though are unique to the instance and not shared.  

When the mirror dialog pops up any existing mirrors are filtered out - you can't create a mirror of a mirror.

It should also be impossible to create a mirror that would result in a circular path.

The user can also create a mirror by holding down the alt key while dragging a node to a new location.  This will leave the original node in its current position and create a new mirror where the node is dropped.

##### 4.2.2.2 Deleting Mirrors
If you delete the original of a mirror then another of the mirrors is promoted to being the original.  The should be true not only if you directly delete the original but also if the original is deleted because you deleted an ancestor of the original.

##### 4.2.2.3 Tracking Mirrors
There should be a right hand border to the outline pane.  If a mirror (or original of a mirror) node is showing then there should be a circle in the right hand border, aligned with the first line of text of the node, which shows the number of mirrors for that node.  if the user clicks on this circle a popup dialog should appear showing the paths to the original and to each mirror.  The path to the original should be highlighted.  If the user clicks on one of these entries in the popup that mirror (or original) becomes the focused node for the pane.

#### 4.2.3 Tags
Type # or @ initiates the tag creation process.   When the user types the trigger character a popup list will appear showing any tags that already exist anywhere in the outline sorted by most recently created with the most recent first.  If the user starts the process by typing # then the list will only contain tags beginning with # and if the user starts with @ the popup will only show tags starting with @.

As the user keeps typing the list of tags will filter to match what the user is typing.  The first tag in the list will be highlighted by default but the user will be able to use the arrow keys to highlight a different tag in the list.  If the user hits return the highlighted tag will replace the # and text the user typed.  The user can also use the mouse to click on a tag in the list to select it.

Once a tag is inserted the cursor will be placed after a space after the tag.  If there isn't a space after the tag one will be added.  The tag will appear as a coloured pill.  

If the user backspaces to the end of a tag then the tag will revert to plain text and the tag suggestion popup will appear again.

#### 4.2.4 Natural Language dates
As the user types the app should check if the user has typed a natural language date (there should be standard packages we can import to do this) if so the date should appear in a popup and if the user hits tab the date should be replaced with a date tag.  The cursor should move to a space after the date tag.  If there is no space after the date tag one should be inserted.

The date tag should record the actual date but display the date using the default format ddd, MMM D a time element should only be included in the displayed text for the date if the user actually types a time otherwise the time element should not be included.

The date tag should appear as a pill with a light grey background.

#### 4.2.5 Formatting after text selection
If the user highlights some text in a node then a floating horizontal menu should appear with the following formatting options to be applied to the selected text if selected:
- H1 - H5
- B for bold (the B should be bold)
- I for Italics (the I should be in italic)
- A symbol for underline
- A symbol for text colour
	- If the user clicks this a palette of 8 standard colours from across the colour spectrum will appear with an area below for a custom colour picker.  The colour selected will be applied as the text colour for the highlighted text.  The pallete of standard colours will also remember and include the 8 most recently selected colours.  If a user hovers over a colour on the paletter the #code for the colour will appear as hover text.
- A symbol for background colour
	- If the user clicks this a similar palette to the one described for text colour above will appear. The selected colour will apply to the background of the selected text.  

---
## 5. Multiple Panes
### 3.2 Panes
- **Tree Pane**: default hierarchical view with virtualization on web.
  - Each pane has a header bar with a breadcrumb showing the path to the focused node and a search icon.  If the search icon is clicked the breadcrumb is replaced with a search input area.  There is a cross in the far right of the header bar to allow the pane to be closed.
- **Tasks Pane**: cross-cutting view aggregating `todo` nodes with due-date grouping and quick jump to source.

### 3.3 Pane management
- Open a new pane via:
  - **Link click modifiers** inside editor:
    - **Click** wiki link → open target node in current pane as the focused node
    - **Click** bullet of node -> open that node in current pane as the focused node
    - **Shift+Click** wiki link or node bullet → open in the pane immediately to the right of the current pane. If there is no pane immediately to the right then create one.
    - **Ctrl+Click** wiki link or node bullet → open in new pane immediately to the right of the current pane.
- Pane focus: exactly one pane is “active” (affects keyboard handling).

### 3.4 Layout considerations
- Panes are resizable with a draggable gutter (web/desktop).
- Minimum pane width to keep editor usable.
- Virtualized lists keep scroll performance stable for large trees.
- On small screens (native/web mobile), panes stack; only one pane is visible at a time but with a list of open panes in the side panel to allow the user to switch panes.
- If an outline pane is the only outline pane currently open then the cross used to close the pane is not visible




---

## 7) Search & indexing

### 7.1 Search input & fallback

- Free-text queries search `text` by default.
- If the advanced parser fails (e.g., during typing), the UI temporarily falls back to `text contains` to keep results updating smoothly.

### 7.2 Advanced query language
- **Fields:** `text`, `path`, `tag`, `type`, `created`, `updated`.
- **Operators:** `:`, `=`, `!=`, `>`, `<`, `>=`, `<=`.
- **Boolean:** `AND`, `OR`, `NOT` (case-insensitive).
- **Grouping:** parentheses `( … )`.
- **Quoted strings:** `"exact phrase"`.
- **Tag shorthand:** `#tagName` (equivalent to `tag:tagName`).
- **Ranges:** `field >= "A" AND field <= "M"` or `created:[2024-01-01..2024-12-31]` (parser uses two filters; UI may expose a helper).
- **Case-insensitive** comparison for string fields; dates compare by `Date.parse` values.

### 7.3 Search index
- An index is maintained to keep searches efficient
- Index updates on edits/moves and on import.

### 7.4 Search Results
When search results are shown the following rules should apply.
- Each node that matches the search results should be shown within its hierarchy i.e. all ancestor nodes should be shown
- If an ancestor node is showing all it's children (because the either all match the search criteria or have descendants that match the search criteria) then it should be shown as fully open
- If an ancestor is only showing some of its children (because some are filtered out by the search criteria because they don't match the criteria and have no descendants that match the criteria) then the expand contract arrow should point down 45 degrees rather than straight down and the bullet should still have the outer grey circle to show there are hidden nodes.
- If you edit a node in the search tree so that it no longer matches the search criteria it should not disappear.  Once the search has produced its results the search criteria should not be reapplied until the user hits enter again in the search bar.
- Similarly if you add a new node by hitting return at the end of a search result, the new node should be visible, even if it doesn't match the search results.

### 6.3 Quick filtering
- Clicking a tag chip applies a *pane-local* quick filter `tag:tagName` in the search input.
- Clicking the same tag again toggles the filter off.
- Multiple tags quick-filter combine with `AND` semantics unless the advanced query specifies otherwise.

---

## 9) Tasks & the To‑Do pane
In Tasks pane: 
- Caret at start or in middle: no action
- Caret at end: create a new child bullet as the first child
### 9.1 Task detection & structure
- A node becomes a **task** when the To‑do command is applied (adds `todo` metadata).
- **Due date** tokens (‘today’, ‘tomorrow’, ISO dates, weekdays) detected inline; dedicated helper strips time tokens from display while preserving metadata.

### 9.2 Tasks pane behavior
- Aggregates all tasks across the tree (optionally filtered by search/tags).
- Grouping by due date buckets: *Overdue*, *Today*, *Tomorrow*, *This Week*, *Later*, *No date*.
- Within each of the above buckets tasks are further grouped by date (without the time element)
- Each grouping is collapsible by clicking the group header
- Multiple tasks can be selected or by shift clicking
- Tasks can be dragged and dropped onto a group header.  The due date of the tasks will be updated according to the group in which the tasks were dropped.
- Clicking a task bullet focusses the task in the pane immediately to the left of the Task pane
- Checkbox toggles `done` without leaving the pane.
- Virtualized list for performance.


---

## 12) Right‑click / context menus

**Node context menu:**
- Open in New Pane / Open in Right Pane.
- Toggle To‑do; Set Heading (H1–H3); Paragraph; Bullet / Numbered list.
- Text Color / Background Color (and **Reset**).
- Move to… (opens Move dialog with search).
- Delete (with confirm).
- Mirror to… (opens Mirror dialog).
- Copy / Cut / Paste (sanitized).
- Collapse / Expand subtree.

**Multi‑select menu:**
- Bulk Apply: Paragraph, Headings, Bullet/Numbered, Text/BG color, To‑do.
- Move to…, Delete.

---

## 13) Command menus & dialogs

- **Command Menu (`/`)**: searchable list of actions (formatting, move, delete, colors).
- **Tag Menu (`#`)**: prefix-based suggestions from the known tag set; Arrow keys navigate; Enter inserts; Esc cancels.
- **Wiki Dialog (`[[`)**: search by text/path/tags; excludes current node; Enter inserts wiki link to the target.
- **Mirror Dialog (`((`)**: like Wiki dialog but for mirrors.
- **Jump Dialog**: quick-jump to nodes by typing a query; Enter focuses.
- **Move Dialog**: choose a destination node; Enter moves the selection.
- **Date Picker / Suggestions**: accept natural-language dates and insert normalized tokens.
- **Profile Menu & User dialogs**: user switch, settings, export/import.

All dialogs:
- Use consistent shell with **Esc to close**, **Enter to confirm**.
- List UIs are keyboard navigable with ARIA roles and virtualization for long lists.

---

## 14) Import & export

### 14.1 Import
- **OPML**: drag-and-drop or file chooser (web). Parse into nodes preserving hierarchy.
- **JSON**: full snapshot import (with explicit “type the confirmation text” step before overwriting).
- On import:
  - Rebuild search index.
  - Maintain timestamps if present; else set `created/updated` now.
  - Sanitize node text.

### 14.2 Export
- **JSON**: current snapshot (with `id`, HTML `text`, children, metadata).
- **OPML**: tree with plain-text conversion of HTML (strip tags; retain tags as `#tag` text).
