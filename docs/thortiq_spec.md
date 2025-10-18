# Thortiq Functional Specification

## Product goals & principles
- **Outliner-first:** fast, keyboard-driven, infinitely nestable tree of nodes with inline rich text similar to Workflowy, Tana and Roam Research
- **Offline-first:** works without connectivity; syncs when available.
- **Local-first**: Data is stored on the device.  However when a new device is connected it can immediately load data from the sync server.  
- **Multi-platform**: It should be possible to run the application on the web, windows desktop, android and iOS.
- **Multi-device**:  If I have the app open on multiple devices the data should sync in near realtime.
- **Multi User**: Each user has their own account with separate data but it should be possible to share nodes with other users and to see what edits they are making as they make them.
- **High Performance**: Users may have outlines with hundreds of thousands of nodes.  These outlines should be quick to load and quick to scroll with no degradation of UX when the user opens a node that contains many thousands of descendants.

## Cost Implications
- I will have an AWS server to host the web app and sync server.  This will be a lightsail server fronted by Caddy.  I need an architecture that keeps costs down as I roll it out.  I will initially run a single user account and want the costs to be below £7 per user and for these costs to drop as it scales to around £1 to £2 per user.  Assume that each user will 
---

## 0. Terminology
- **Node**: the fundamental item in the tree; contains HTML text and metadata.
  - A node **MUST NOT** become a descendant of its own mirror (cycle prevention).
  - Move operations that would create cycles are blocked with a user-visible warning.
- **Mirror**: a node entry that points to another node (`mirrorOf`), sharing text/metadata.
  - Mirrors are not valid drop targets when selecting mirror target 
- **Pane**: a top-level viewport showing either an outline of nodes (tree pane) or a grouped set of tasks (tasks pane)
- **Session**: a saved app state (tree root, expanded/collapsed, open panes, selection) that can be restored later.
- **Tag**: a clickable inline token rendered inside node HTML.
- **Task**: a node with `todo` metadata; rendered with a checkbox and surfaced in the Tasks pane.
- **Wiki Link**: A clickable link within the text of a node that points to another node in the tree.  When clicked that target node becomes the focused node of the pane and the pane only shows this node and its descendants


## 1 Architectural Considerations
### 1.1 Platforms
React for the web app
React Native for mobile apps
Electron for desktop
 
### 1.2 Conflict free sync
To support conflict free sync we will be using Yjs.

### 1.3 Virtualisation
To ensure we have good UX performance even with 100s of thousands of nodes we will implement virtualisation using the TanStack virtualisation library.

### 1.4 Prosemirror Implementation
Because the text editor will need to support text formatting (e.g. bold, italic, text colour, background colour), formatted tag pills and both internal and external links, we will need a rich text editor capable of integrating with Yjs and a common undo redo channel that can support long wrapped text in resizable rows without affecting TanStack's ability to measure row height in order to properly calculate which rows to draw.

For the editor we will be implementing ProseMirror according to best practice patterns providing the necessary hooks and plugins to support the other requirements in this document as appropriate.

In order to keep performance high we will only mount one prosemirror instance on the active node.  The other nodes will be displayed as read-only html.

You should research best practice implementation patterns for ProseMirror and apply them appropriately.

The design of the prosemirror integration must follow these rules.  If you believe any rule to be inappropriate, ask before implementation.

1. **Seamless Switching**:  Entering and leaving edit mode must display identical text (no flicker, no vertical/horizontal shifts) regardless of font, spacing or browser. First click immediately activates the rich editor and positions the caret where the user clicked.
2. **Visual Parity**: HTML view and rich editor share identical typography, whitespace, wrapping, leading and trailing space handling. Long lines wrap naturally.
3. **Virtualisation**: Do not break TanStack Virtual row measurement or proper virtualisation.
4. **Yjs support**: No HTML mutation outside Yjs transactions (AGENTS.md rule). 
5. **Undo/Redo support**: Editor must drive undo/redo via the Yjs flow, preserving per-node undo order.
6. **Special character processing, selection and drag and drop**:  The editor must have the appropriate hooks, guards and / or plugins to support all of the relevant requirements in sections 2, 3 and 4 below .
7. **Collaboration**:  Rich edits synchronise across clients through Yjs exactly.
8. **Performance**: Keep Node IDs stable and avoid frame-timing hacks that depend on single RAF; prefer deterministic sequencing.

### 1.5 Code Organisation
Keep node modules separate from the rest of the code so that I can easily zip up the code without the node modules. 

Use pnpm rather than npm.

## 2. Basic UI
The main pane of the application will present a collapsible tree of nodes.  

At some point in the future we may allow the user to have multiple panes open showing different sections of the tree by clicking the bullet of a node in a pane to focus it in that pane.  Row selection, expand collapse state and which node is focused in the pane should all be state that is held at the session / pane level.  I should be able to have multiple panes open within a single tab and multiple tabs open and selecting nodes, expanding or collapsing nodes or focusing on a node in one pane should not change the selection, expand / contract state or focus node in any other pane in this or any other tab.

### 2.1  Expand Collapse Icons
If a node has child nodes (i.e. it is a parent node) then there should be an expand collapse icon (an arrowhead) that the user can click to toggle whether the children are shown or hidden. 

The presence or absence of an expand / collapse icon should not affect the alignment of bullet nodes.  Nodes without children should simply have a space where the expand collapse icon would be.

If I have two tabs open 

### 2.2 Node Size
A node might contain a very long string and therefore wrap across multiple lines. The node height should therefore be variable and adapt to show the full content of the node without scrollbars.

### 2.3 Node Bullets
There should be a bullet to the left of the node.  The bullet should always align with the center of the first line of text of the node.

If a parent node is collapsed then the bullet of that node should be shown as a normal sized bullet inside a larger light grey circle.  This indicates that there are hidden nodes which could be seen by opening the node.  If the parent node is open then the bullet should just be displayed as a standard bullet.

### 2.4 Node selection
The user should be able to select multiple nodes by dragging the cursor across multiple nodes.  Selected nodes have a light blue background.

I should be able to have to tabs open and select different sets of nodes on each tab.  Selecting a node on one tab should not impact the selection on another.  

### 2.5 Basic Node Editing
The user can click anywhere on a node and the editing cursor appears wherever the user clicked on the node. 

#### 2.5.1 Enter key
If the user hits enter then a new node should be created.  The position and parent of the new node depends on where the cursor was when enter was entered according to the rules below:

- Caret at **start**: insert a sibling **above**.
- Caret in **middle**: **split** node at caret and caret should be at the start of the new node which should be the next sibling of the original node
- Caret at **end**:
	- If node has visible children and is **expanded**: create **child**.
	- Else: create **sibling below**.

#### 2.5.2 Tab / Shift+Tab
The tab key should be intercepted so that it isn't processed by the browser. Instead, pressing tab should indent the current node under its previous sibling.  If there is no previous sibling then nothing should happen.  If the current node is one of a set of selected nodes then the indent should apply to all selected nodes except that if any nodes are children of another selected node they should remain children of the selected parent node.  If any node cannot be indented (because it has no previous sibling) then none of the nodes should be indented. 

Similarly shift tab should be intercepted so that it isn't processed by the browser, instead pressing shift tab should outdent the current node to become a sibling of its parent.  If the node has no parent then nothing should happen.  If the current node is one of a set of selected nodes then the outdent should apply to all nodes except that if any nodes are children of another selected node they should remain children of the selected parent node.  If any node cannot be outdented (because it has no previous parent) then none of the nodes should be outdented.

If you indent under a node that doesn't have children then the node should be open after the indent. If you indent under a node that does have children the collapse state should remain the same.
#### 2.5.3 Arrow Up/Down
If the user hits the down arrow and the caret is currently at the end of the line move focus to next visible node (respecting collapsed state). 

If the user hits the down arrow and the caret is not currently at the end of the line move the caret to the end of the line.

If the user hits the up arrow and the caret is currently at the start of the line move focus to previous visible node (respecting collapsed state). 

If the user hits the up arrow and the caret is not currently at the start of the line move the caret to the start of the line.

#### 2.5.4 Backspace
The behaviour to follow after hitting backspace depends on the cursor position as described in the table below:

| Scenario                          | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Selection exists                  | Delete selection within node only.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Caret not at start                | Delete previous character.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Caret at start and node empty     | Merge into previous visible sibling or parent (if there is no previous sibling) with the cursor positioned at the end of the previous visible sibling or parent.                                                                                                                                                                                                                                                                           |
| Caret at start and node non-empty | If there is no previous sibling or both the current node and the previous sibling have child nodes do nothing otherwise merge text into previous sibling placing the cursor at the start of the text appended to the previous sibling.  <br><br>Any children of the node being merged become children of the previous sibling.  Any wikilink references to the node being merged are refactored to be references to the newly merged node. |

#### 2.5.5 Ctrl-Shift-backspace
Delete selected nodes.  If this would delete more than 30 nodes (including descendants) ask for confirmation first.

#### 2.5.6 Ctrl-enter
Hitting ctrl-enter should mark a node as done by addkng opacity and strikethrough to the text of the node to indicate it is done.  Hitting ctrl-enter on a node that is already marked as done toggles the done state off.  If multiple nodes are selected the toggle should apply to all selected nodes.

#### 2.5.7 New node button
There should be a new node button shown as a plus sign in a circle.  This should float just beneath the last visible node on the page centre aligned with the bullets of the nodes of indent level 0.

If the button is clicked it should create a new node.  If no node is focused in the pane the new node should be a new root node otherwise it should be the last child of the focused node.

### 2.6 Drag and drop
It should be possible to drag a node by its bullet and drop the node in a new position in the tree.   While dragging, a grey line drop indicator should show between the nodes to show where the new node will be placed (i.e. as a sibling or child of the drop target node).

The position of the node after being dropped, and the position of the drop indicator while dragging, depends on where the cursor is as follows.

If you refer to the diagram in drag_and_drop.png in the docs folder you will notice the following:
- Nodes have multiple areas:
	- Multiple red boxes - one for each ancestor followed by one for the bullet
	- A single blue box - for the text of the node
- The bullet and the text touch the top of their respective boxes. There is no margin or padding above the text. This means that if you hover even slightly over the bullet or text of a node you are hovering over one of the red boxes or the blue box of the node above i.e. all the space between nodes belongs to the node above.

The rule for where a dragged node will go, and where the drop indicator line will be drawn, can be summarised as:
- If you hover over a red box the dropped node will be a sibling of the node to which the red box is allocated and the drop indicator will be drawn under the last red box allocated to that node with the left edge aligned with the left edge of the red box and the right edge aligned with the right edge of the outline pane.  Remember that each node may have multiple red boxes but only one (the one containing the bullet) is allocated to that node.  The ones to the left of that are allocated to each of its ancestors in turn.
- If you hover over a blue box the dropped node will be a child of the node to which the blue box belongs and the the drop indicator will be drawn under the blue box with the left edge aligned with the left edge of the blue box and the right edge aligned with the right edge of the outline pane.
In the diagram in drag_and_drop.png therefore the following would be true:
- If you hover  over any of the red boxes with an 'a' in them  the drop indicator would be where the green line with an 'a' at the end is shown on the diagram.
- If you hover over the blue box around the text of Node 1 with a 'b' in it the drop indicator would be where the orange line with a 'b' at the end is shown on the diagram.
- If you hover over the red box with a 'c' in it the drop indicator would be where the green line with a 'c' at the end is shown on the diagram.
- If you hover over the blue box around the text of Node 2  with a 'd' in it the drop indicator would be where the orange line with a 'd' at the end is shown on the diagram
- If you hover over any of the red boxes with an 'e' in them the drop indicator would be where the green line with an 'e' at the end is shown on the diagram.

As you hover over the various boxes the drop indicator should move to show where the nodes will now be placed if you drop them.

If a dragged node is one of a set of selected siblings then all the selected nodes should be moved according to where the node is dropped as described above. The drag icon should show the number of items being dragged. If multiple items are dragged then they should still be in the same relative order after being dropped.


### 2.7 Ancestor Guidelines
If a parent node is open then there should be a vertical guideline that stretches from under the bullet of the parent to the bottom of the last visible descendant of the parent.

Hovering over a guideline causes the guideline to thicken to make it easier to click.

If you click a guideline then it will expand / collapse the immediate children of the parent whose bullet the guideline is under according to the following rules:

- If any of the immediate children are open then all children will be closed.
- If all the children are closed then they will all be opened.

If is often easier to draw the guidelines by having the children draw a left border to represent that section of the guideline for each ancestor - this means the ancestors doesn't have to do complicated calculations about how to draw their own guidelines and calculate the appropriate height.  Hovering over any section of a guideline should highlight all corresponding sections.  Bear in mind that each node already has drop zones for each ancestor to integrating this with drawing a section of the guideline for each parent might be worth exploring.

### 2.8. Undo / Redo

All local edits should pass through the same undo/redo manager.  This should include text edits, format changes and structural changes to the tree.  Undo / Redo should only apply to locally made edits, not remote edits applied by the sync server.



### 2.9 Quick Note
If the user clicks Alt-n then a popup will appear in the middle of the screen where the user can type a quick note.  When the user hits save the note will be created as the first child of the Inbox node.  

If no node has been set as the Inbox node then the note will be created as a new root node.
## 3.  Cross device synchronisation
I have set up an AWS lightsail server, fronted by Caddy, to host the web app and websocket synchronisation server.

Although data is stored locally, and any client (web, desktop, android or iOS) can work offline, whenever the application is connected to the internet the sync server should ensure reliable, conflict free synchronisation across clients.

If two clients are connected at the same time then synchronisation should be near real-time.  


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
If the user changes the focused node then we should remember the history of what the focused node was showing before the move.  There should be forward and back arrows (< and > characters) in the top right of the outline pane in the same row as the breadcrumb.  If the user changes the focus of a pane then the back (<) arrow should highlight.  If the user clicks the back arrow then the forward (>) arrow should highlight.

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
Typing `((` opens a popup **Mirror dialog** very similar in behaviour to the Wikilink dialog.  The popup for the mirror dialog and the popup for the Wikilink dialog should share common code as far as possible.  The main difference is that when the user selects a node, instead of creating a wikilink to the selected node it creates a mirror.  If the cursor is on a bullet with no text then that node becomes the mirror otherwise a new sibling is created below the current node and the new sibling becomes the mirror.

A mirror is essentially another instance of the original node.  Any changes to one instance are immediately reflected in the other.  The open and closed states though are unique to the instance and not shared.  

When the mirror dialog pops up any existing mirrors are filtered out - you can't create a mirror of a mirror.

It should also be impossible to create a mirror that would result in a circular path.

The user can also create a mirror by holding down the alt key while dragging a node to a new location.  This will leave the original node in its current position and create a new mirror where the node is dropped.

##### 4.2.2.2 UI for Mirrors
Mirrors should have 1px circle around the bullet whose diameter is equal to the diameter of the grey halo that surrounds collapsed parents.  For a collapsed parent this appears as a border around the halo, for other nodes this is just a circular border with no fill.  The original node circle will be orange, the mirror nodes will have blue circles.

##### 4.2.2.3 Children of Mirrors

The children of a mirror should all have unique Id's from the children of the original in case both the original and the mirror are shown expanded in the tree where the virtualizer will expect all nodes to have unique id's.

The creation of mirrors should be very performant even if the original has 10K descendants.

##### 4.2.2.4 Deleting Mirrors
If you delete the original of a mirror then another of the mirrors is promoted to being the original.  The should be true not only if you directly delete the original but also if the original is deleted because you deleted an ancestor of the original.  

Deleting a mirror will remove the edges for the children of that mirror but the children of the original and any other mirrors will remain untouched.  Similarly if you delete the original, the children of the mirrors will not be deleted.

However, if you delete a child of a mirror the corresponding child of the original should be deleted, and vice versa, so that the original and mirror are kept in sync.

##### 4.2.2.5 Tracking Mirrors
There should be a right hand border to the outline pane.  If a mirror (or original of a mirror) node is showing then there should be a circle in the right hand border, aligned with the first line of text of the node, which shows the number of mirrors for that node.  if the user clicks on this circle a popup dialog should appear showing the paths to the original and to each mirror.  The path to the original should be highlighted.  If the user clicks on one of these entries in the popup that mirror (or original) becomes the focused node for the pane. The original path should be in orange.

#### 4.2.3 Tags
Typing # or @ initiates the tag creation process.   When the user types the trigger character a popup list will appear showing any tags that already exist anywhere in the outline sorted by most recently created with the most recent first.  If the user starts the process by typing # then the list will only contain tags beginning with # and if the user starts with @ the popup will only show tags starting with @.

As the user keeps typing the list of tags will filter to match what the user is typing.  The first tag in the list will be highlighted by default but the user will be able to use the arrow keys to highlight a different tag in the list.  If the user hits return the highlighted tag will replace the # and text the user typed.  If there is not highlighted option when the user hits return then whatever the user has typed will become a new tag.  The user can also use the mouse to click on a tag in the list to select it. 

If the user hits space at any point after starting to type following a # then whatever the user has typed will be converted into a tag.

Once a tag is inserted the cursor will be placed after a space after the tag.  If there isn't a space after the tag one will be added.  The tag will appear as a coloured pill.  The text in the tag pill will be the same size as normal text.  The padding around the text for the coloured pill will be narrow - only a few pixels.

If the user backspaces to the end of a tag then the tag will revert to plain text and the tag suggestion popup will appear again.

If the user is typing near the edges of the screen the popup position will be adjusted to ensure that it doesn't obscure the text the user is typing and yet always remains fully visible on screen.

If the user clicks on a tag then the search bar will appear with the tag in the search preceded by the keyword tag: e.g. `tag:tagname`.  If there is already a search term in the search bar then the tag condition will be added to the end.  if the user clicks the tag a second time the corresponding tag condition will be removed from the search.

#### 4.2.4 Natural Language dates
As the user types the app should check if the user has typed a natural language date (there should be standard packages we can import to do this) if so the date should appear in a popup and if the user hits tab the date should be replaced with a date tag.  The cursor should move to a space after the date tag.  If there is no space after the date tag one should be inserted.

The date tag should record the actual date but display the date using the format specified for date pills in the user settings.  If not format has been specified the default format should be ddd, MMM D. A time element should only be included in the displayed text for the date if the user actually types a time otherwise the time element should not be included.

The date tag should appear as a pill with a light grey background.

#### 4.2.5 Formatting after text selection
If the user highlights some text in a node then a floating horizontal menu should appear with the following formatting options to be applied to the selected text if selected:
- H1 - H5
	- If the user selects one of these the row will be marked as a header and styled accordingly.  H5 should be the same size as standard text, H4 should be slightly larger than the standard text, H3 slightly larger than that and so on.  All headers will be bold.
- A paragraph symbol for paragraph
	- If the user selects this option the node will be flagged as a paragraph and the bullet will be hidden until the user hovers over the row.  The space for the bullet will still be there so that the relative position of the text doesn't move.  However, if the the node has children then the bullet and expand collapse icons will be visible if the node is collapsed but will be hidden until you hover over the row.
	- If the paragraph flag is set the numbered flag is cleared.
- N for numbered list
	- If the user selects this option the selected nodes will be flagged as numbered and the bullet will be replaced with a number.  Siblings will be numbered sequentially.  If a set of selected siblings has a preceding sibling that is already flagged as numbered then the first number of the selected items will continue the sequence of the preceding sibling.
	- If the numbered flag is set the paragraph flag will be cleared.
- A bullet symbol for bullet
	- If the row was flagged as paragraph or numbered list these flags will be cleared so that the bullet appears as normal.
- B for bold (the B should be bold)
- I for Italics (the I should be in italic)
- A symbol for underline
- A symbol for text colour
	- If the user clicks this a palette of 8 standard colours from across the colour spectrum will appear.  The colours will have 50% opacity.  If the user clicks on a colour that colour will become the text colour and the palette will disappear.
	- The will be a an edit icon in the bottom right corner of the colour palette.  If the user clicks this then a plus button, a save button and a cancel button will appear and the palette will enter edit mode.   The behaviour of the pallet in edit mode will change so that if the user clicks a colour then a colour picker will appear and the user can select a colour to replace the one on the palette.  If the user clicks the plus button the colour picker will appear again and the colour selected will be added to the palette in addition to the existing colours on the palette.  If the user clicks save the new colours will become the standard colours for the palette and the palette will exit edit mode.  If the user clicks cancel, and the user has edited the colours, a confirmation message will appear asking if the user wishes to undo all their changes.  If the user clicks yes the confirmation disappears, the palette will exit edit mode and the colours will revert to their state before edit mode was entered.  If the user hits no the confirmation disappears and the palette remains in edit mode with the changes intact.  If the user hits cancel after having made no changes the palette will simply exit edit mode.
- A symbol for background colour
	- If the user clicks this a similar palette to the one described for text colour above will appear. The selected colour will apply to the background of the selected text.  
- A symbol for "Clear formatting".  
	- If the user clicks this option then any formatting applied to the selected text is cleared.

---
## 5 Slide out side panel

At the top-left (web) or platform-appropriate entry point is an icon that toggles the visibility of a side panel that slides out from the left.
The side pane contains the following items
- A user profile picture in a circle followed by the name of the user.  If the icon or name are clicked the profile dialog appears where the user can set a profile picture, enter their email address and reset their password.
- A settings option which if clicked opens the settings dialog
- An import option which if clicked pops up a sub-menu with two options
	- import Workflowy OPML
	- import Thortiq JSON
- An Export

The side panel pushes the content area over and sits next to it with a space between them which the user can drag to resize the side panel.

## 6. Multiple Panes
It should be possible to have multiple outline panes open at the same time side by side.  One pane is always the 'active' pane and is indicated as such by a solid blue line below the header containing the breadcrumb and search bar. If there is more than one pane open then each pane will have a small cross at the right of the header bar to allow the pane to be closed.  If there is only one pane open then the cross will not be visible.

### 6.1 Opening new panes
There are several ways to open a new pane as explained in the following sections.  
#### 6.1 Ctrl-click on a wikilink
This should open a new pane immediately to the right of the current pane focused on the target of the wikilink.  

#### 6.2 Ctrl-click on a bullet
This should open a new pane immediately to the right of the current pane focused on the the bullet the user cltrl-clicked.

#### 6.3 Shift-click on a wikilink
If there is already a pane immediately to the right of the current pane then the focus node of that pane should change to be the target of the wikilink.  If there is no pane immediately to the right of the current pane then a new one should be created.

#### 6.3 Shift-click on a bullet
If there is already a pane immediately to the right of the current pane then the focus node of that pane should change to be the bullet the user shift-clicked.  If there is no pane immediately to the right of the current pane then a new one should be created.

#### 6.4 Ctrl-N anywhere.  
If the user hits ctrl n a new pane will be created immediately to the right of the current pane.  This pane will be created with a new bullet in it which will be a sibling of the focus node of the current pane.  If there is no focus node in the current pane then the new bullet will be created at the root level of the tree.

### 6.2 Layout considerations
- Once a new pane is opened the caret will be at the start of the first node in the new pane and the new pane will be the active pane.
- Panes are resizable with a draggable gutter (web/desktop).
- There should be a sensible minimum pane width to keep editor usable.
- Virtualized lists keep scroll performance stable for large trees in all panes. All panes scroll independently.
- On small screens (native/web mobile), panes stack; only one pane is visible at a time but with a list of open panes in the side panel to allow the user to switch panes.
- If an outline pane is the only outline pane currently open then the cross used to close the pane is not visible
- Each pane has its own header with the breadcrumb, search bar etc.  Any search should only apply to the pane to which the header belongs.


---

## 7) Search & indexing

### 7.1 Search input
Each pane should have a black and white outline search icon (stylistically matching the home button in the breadcrumb) in the top right of the pane header to the left of the navigation arrows.  If the icon is clicked the breadcrumb is replaced by a search input field where the user can enter search criteria using the query language described below.  The search input field should have a grey border to match the colour of the home icon.  The input field should not highlight when the user clicks into it to start editing.

The navigation arrows to the right of the search bar should still be visible and function.  The home button should still be visible to the left of the search input field, positioned exactly where it would be if the breadcrumb were still visible.

There should be a small cross at the left hand edge of the input field (with a little left margin).  If the user hits the cross while there are search criteria in the search input the criteria should be deleted. If the user hits the cross a second time the search input should be removed and the breadcrumb should re-appear.

If the user focuses on a node, clicks on a wikilink or clicks one of the forward or back navigation icons the search should be cleared, the search input removed and the breadcrumb should re-appear.

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
The search results will replace the previously shown nodes in the outline pane.  Do not keep the current active node in the search results unless it matches the search criteria or is an ancestor of a node that matches the search criteria.

When search results are shown the following rules should apply.
- Each node that matches the search results should be shown within its hierarchy i.e. all ancestor nodes should be shown (and should be expanded temporarily if they were collapsed before).
- If an ancestor node is showing all it's children (because they either all match the search criteria or have descendants that match the search criteria) then it should be shown as fully open
- If an ancestor is only showing some of its children (because the others don't match the criteria and have no descendants that match the criteria) then the expand contract arrow should point down 45 degrees rather than straight down and the bullet should still have the outer grey circle to show there are hidden nodes.
- If you edit a node in the search tree so that it no longer matches the search criteria it should not disappear.  Once the search has produced its results the search criteria should not be reapplied until the user hits enter again in the search bar.
- Similarly if you add a new node by hitting return at the end of a search result, the new node should be visible, even if it doesn't match the search results.  The position of the new node should follow the same rules as currently with the additional note that a partially opened node is treated as a fully opened node when deciding where to put the new node after the user hits enter at the end of the row i.e. it should become a new first child of the partially opened row and should be visible.
- The user should be able to click the expand / contract arrows to collapse or open nodes in the search results.  If the user clicks the expand / collapse arrow on a partially opened node it should become fully opened and show all children.  If the user clicks the arrow again the node should be fully closed.  Clicking the arrow again should fully open the node again showing all children and so on.

Because the list of nodes will suddenly change after applying the search, and especially because some nodes will now only show some children and so will be smaller than they were, the Tanstack cache may contain stale sizes causing some nodes to be positioned incorrectly.  Please check changes made in feat/search-codex for changes made in that branch to address this issue.  Compare these changes to best practices described online to ensure that Tanstack manages changes in node heights correctly.


## 8) Right Click Menu

The user can right click on a node and a menu will appear with the following options:

- Format
- Turn Into
- Move To
- Mirror To
- Delete

Each of these options is described in the following sub-sections.

If multiple rows are selected and the row the user right clicks on is one of the selected set then all of the commands in the right click menu should apply to all of the selected nodes.

### 8.1 Format
If the user hovers over or clicks this option a sub-menu will appear with a vertical list of the options that appear on the horizontal popup formatting menu that appears when the user highlights text.  In the vertical menu each of the icons for the formatting options is followed by appropriate text.

When an option is selected the formatting is applied to the whole text of the selected nodes.

If the user selects "Clear formatting" then this should clear formatting applied to the whole row as well as any formatting applied to individual sections of the text with the popup menu that appears when the user selects some text

### 8.2 Turn Into

If the user hovers over or clicks this option a sub-menu will appear with the following options.
- Task
- Inbox
- Journal

#### 8.2.1 Task
If the user clicks this option the row will be marked as a task.  Tasks will have a tickbox after the bullet and before the text.  The bullet is not part of the text so can't be deleted by backspacing. 

If you click the the tickbox the node is marked as complete in the same way as if the user had hit ctrl-enter.  If the user unticks the the tickbox the node is no longer marked as complete.

#### 8.2.2 Inbox 
There can only be one Inbox node.  If the user clicks this option the node is marked as the inbox node.  If there is already a node marked as the inbox node a popup confirmation dialog will appear asking the user if they wish to change the inbox node.  The dialog box will show the path to the current inbox node.

Any note created when the user selects the Quick Note option below will be added as the first child of the Inbox node.

#### 8.2.3 Journal
There can only be on Journal node.  If the user clicks this option the node is marked as the Journal node.  If there is already a node marked as the Journal node a popup confirmation dialog will appear asking the user if they wish to change the Journal node.  The dialog box will show the path to the current Journal node.

The Journal node will be use later when we introduce daily notes

#### 8.3 Move To
If the user clicks this option a dialog box will popup that is similar to the wikilink and mirror popup dialogs (and shares common code with them where possible) that shows a list of nodes.  

This popup though has an additional area at the top in which the user can type.  If the user types in this area the list of nodes is filtered to only show those that contain the strings the user types. 

If the user types several words in the input area, any nodes that contain each of the strings (not necessarily in the order entered by the user) will be presented.  The nodes will be sorted by shortest matching text first.

By default the first node in the popup dialog will be highlighted and if the user hits return then this node will automatically be selected.  The user can also use the arrow keys to move the focus up and down the list.  When the user hits return the focused node will be selected.  The user can also click on a node in the popup to select it.

To the right of the input area at the top of the popup there will also be a dropdown  box with two options "First Child" and "Last Child" with "First Child" the default.

If the user selects a node then the current node will be moved so that it is now a child of the selected node in the position indicated by the value selected in the dropdown box in the top right of the popup.

The code will ensure that the move cannot create a circular relation with mirrors inside another mirror of the same original or inside the original itself.
#### 8.4 Mirror To
This option opens a popup box that works exactly the same as the move to popup but this time, instead of moving the node to the selected location the current node is mirrored to the selected location.  

The code will ensure that the new mirror cannot create a circular relation with mirrors inside another mirror of the same original or inside the original itself.

#### 8.6 Delete
If the user clicks this option all of the selected nodes will be deleted.  

The standard delete code should be re-used as far as possible and in all cases delete should follow the following rules:

a) If the total number of nodes (including descendants of the selected nodes) is greater than 30 a popup will appear telling the user how many nodes will be deleted and asking for confirmation.
b) If any of the selected nodes (or any of the descendants of the selected nodes) that will be deleted are the originals of a mirror then the logic to promote a corresponding mirror to be the original should be invoked for each original being deleted.


---

## 9) Task pane

### 9.1 Opening the Task Pane

There will be an option in the side panel called Task Pane with a task icon to the left.  This option will be just below the Journal option in the side panel with appropriate spacing.  The task icon will be visible in the collapsed side menu just below the Journal icon.  

If the user hits the Task Icon in the collapsed side panel, or the full option in the expanded panel, a new pane will be opened as the last pane on the right.  

### 9.2 Task Pane Layout

This pane will show all tasks from across the entire tree.  The due date of a task will be determined by the first date pill found in the task.

The tasks will be organised by due date and grouped into the following sections with collapsible headers:

- Overdue - all tasks whose due date is in the past.  
- Today - all tasks whose due date is today
- Next seven days - all tasks for the next seven days starting from tomorrow. 
- Later - All other dated tasks not in the previous groups. 
- Undated - all tasks that have no due date

In all sections, apart from Today and Undated, all tasks will be grouped by day with the day as a collapsible header in the format dddd, MMMM DD, YYYY.  

### 9.3 Task Editing
It should be possible to edit tasks in place in the task pane.  It should also be possible to expand the task node to see the children and to edit those children.

If the user hits return while editing a task in the Task Pane then the rules of where to create a new node are different to the rules in an Outline pane.  In the Task Pane, if you hit return at the end of a task the new node is always created as the first child of the task and the task will be expanded to show the children.  If you hit elsewhere in a task node nothing happens.

### 9.4 Task Rescheduling via Drag and Drop
The user should be able to drag one or more tasks at a time and drop them on a day or section header.  

If the user drops a  task on a day header then the due date of the task should be changed to that of the day header.  

If the user drops a task on the Today section header the task due date (i.e. the first date pill in the task) should be changed to today.  

If the user drops a task on the Next Seven Days header the tasks should be moved to tomorrow.  The Next Seven Days section will have day headers for each day in that section regardless of whether or not there are any tasks for that day in order to make rescheduling tasks using drag and drop easier.  

If the user drops a task on the Later section header the due date will be set to 8 days from today.

### 9.5 Focus nodes and the Task Pane
Because the Task Pane always shows the tasks in the layout described in section 9.2 above, it cannot be used to focus a node in the task pane.  Therefore if the user shift clicks a bullet or wikilink in a pane immediately to the left of the Task Pane it will not re-use the Task Pane to focus the node but will instead create a new Pane.

if the user clicks on the bullet of a Task in the Task Pane it will not focus the task in the Task Pane but will instead open a new Pane to the left of the Task Pane with the task focused in that pane.  If the user shift clicks on the bullet of the task then the task will be focused in the pane immediately to the left of the Task Pane.  If there is no pane immediately to the left of the task pane then one will be created and the task focused in that pane.

### 9.6 Task Pane Header

The Task Pane will have a header similar to an outline pane except it will not show a breadcrumb.  If the user clicks the search icon in the header then any search entered will be used to filter the tasks (and their descendants) shown in the task pane.

The header will also show a toggle labeled 'Show Completed'.  if the toggle is on then completed tasks will be included in the Task Pane.  If the toggle is off then completed tasks are not shown in the Tasks Pane.  The toggle should be off by default when the user opens the Task Pane but the state of the toggle should be remembered on the client between sessions.

## 12) Journal
There should be a calendar icon in the side panel with the text Journal after it.  When the side panel is collapsed only the calendar icon should be visible centered in the collapsed pane.  If the user clicks the icon or text a date picker should appear.  This should be the same date picker that appears when you click on a date pill.  However, this time, if you click on a date or one of the text shortcuts then the system will search for an immediate child of the Journal node whose content contains a date pill with the selected date and then focuses that node in the active pane.  If no child of the Journal node has a date pill with the selected date then a new child of the Journal node should be created with a matching date pill and that node should be focused.  If the matching node does not have any children then a new child should be created.  Once the node is focused the caret should be at the start of the first child node.

If the user types alt-d at any time it should behave as though the user had clicked on the calendar icon in the side bar and selected today's date.

---

## 13) Slash menu

If the user hits / (forward slash) a popup should appear with suggestions for commands that can be run.  As the user types, the list of commands should filter to those that contain all the characters (including space) in the string entered by the user.  As soon as no command contains all the characters (including whitespace) in the string typed then the popup list of commands should disappear.  If the user types a space immediately after the / then the popup menu should immediately disappear.

As with the wikilink popup, the first item in the command popup list should be highlighted by default but the user can use the arrow keys to move the highlight up and down.  If the user hits enter then the highlighted command is executed.  The user can also click on a command in the list to select and execute it.

The commands to include in the slash menu are

- H1, H2, H3, H4, H5, Bullet, Journal, Inbox, Task, Move To, Mirror To - these should all be separate commands and should behave as though the user had selected the corresponding option from the right click menu.
- Time - this should insert the current time in the format hh:mm
- Today - this should insert the current date as a date pill in the format specified in the settings or the default date format
- Move To Date - pulls up date picker and all selected nodes are made children of the relevant date node under the Journal node.
- Got to today - behaves as though the user had clicked the date icon in the side panel and then selected todays date from the popup calendar i.e. find or create a date node in the appropriate place in the Journal then focus that node in the currently active pane (unless this is the task pane in which case focus the node in the leftmost outline pane)

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
