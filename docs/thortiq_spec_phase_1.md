# Thortiq Phase 1 Functional Specification

## Product goals & principles
- **Outliner-first:** fast, keyboard-driven, infinitely nestable tree of nodes with inline rich text similar to Workflowy, Tana and Roam Research
- **Offline-first:** works without connectivity; syncs when available.
- **Local-first**: Data is stored on the device.  However when a new device is connected it can immediately load data from the sync server.  
- **Multi-platform**: It should be possible to run the application on the web, windows desktop, android and iOS.
- **Multi-device**:  If I have the app open on multiple devices the data should sync in near realtime.
- **Multi User**: Each user has their own account with separate data but it should be possible to share nodes with other users and to see what edits they are making as they make them.
- **High Performance**: Users may have outlines with hundreds of thousands of nodes.  These outlines should be quick to load and quick to scroll with no degradation of UX when the user opens a node that contains many thousands of descendants.

## Architectural Choices
- React for the web app
- React Native for mobile apps
- Electron for desktop

## Cost Implications
- I will have an AWS server to host the web app and sync server.  This will be a lightsail server fronted by Caddy.  I need an architecture that keeps costs down as I roll it out.  I will initially run a single user account and want the costs to be below £7 per user and for these costs to drop as it scales to around £1 to £2 per user.  Assume that each user will 
---

## 1. Terminology
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

---
## 2. Basic UI

### 2.1 Main Content Area

The main content area can support multiple panes side by side with each pane resizable by dragging the right hand edge.  Initially a single pane is shown.  There will be multiple types of pane but the initial pane will be an Outline Pane showing a collapsible tree of nodes.

#### 2.1.1  Expand Collapse Icons
If a node has child nodes (i.e. it is a parent node) then there should be an expand collapse icon (an arrowhead) that the user can click to toggle whether the children are shown or hidden. 

The presence or absence of an expand / collapse icon should not affect the alignment of bullet nodes.  Nodes without children should simply have a space where the expand collapse icon would be.

#### 2.1.2 Node Size
A node might contain a very long string and therefore wrap across multiple lines. The node height should therefore be variable and adapt to show the full content of the node without scrollbars.

#### 2.1.3 Node Bullets
There should be a bullet to the left of the node.  The bullet should always align with the center of the first line of text of the node.

If a parent node is collapsed then the bullet of that node should be shown as a normal sized bullet inside a larger light grey circle.  This indicates that there are hidden nodes which could be seen by opening the node.  If the parent node is open then the bullet should just be displayed as a standard bullet.

#### 2.1.4 Node selection
The user should be able to select multiple nodes.  Selected nodes have a light blue background.

The user should be able to select multiple nodes by dragging the cursor across multiple nodes.

#### 2.1.5 Basic Node Editing
The user can click anywhere on a node and the editing cursor appears wherever the user clicked on the node. 

If the user hits enter then a new node should be created.  The position and parent of the new node depends on where the cursor was when enter was entered according to the rules below:

- Caret at **start**: insert a sibling **above**.
- Caret in **middle**: **split** node at caret and caret should be at the start of the new node
- Caret at **end**:
	- If node has visible children and is **expanded**: create **child**.
	- Else: create **sibling below**.

The following keyboard shortcuts should also be implemented

- **Tab / Shift+Tab**: indent / outdent the current node or all selected nodes if the current node is also selected)
- **Arrow Up/Down**: move focus to previous/next visible node (respecting collapsed state).
- **Backspace**:
	- Caret At start: merge with previous sibling if there is one otherwise do nothing.  If the current node has children and the previous sibling has children do not merge - do nothing.
- **Ctrl-Shift-backspace**: delete selected nodes with confirmation if this would delete more than 30 nodes (including descendants).
- **Ctrl-enter** mark the task or bullet as done (add opacity and strikethrough to indicate it is done).  Hitting ctrl-enter toggles the done state off

#### 2.1.6 Drag and drop
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

If a dragged node is one of a set of selected siblings then all the selected nodes should be moved according to where the node is dropped as described above. The drag icon should show the number if items being dragged. If multiple items are dragged then they should still be in the same relative order after being dropped.


##### 2.1.7 Ancestor Guidelines
If a parent node is open then there should be a vertical guideline that stretches from under the bullet of the parent to the bottom of the last visible descendant of the parent.

Hovering over a guideline causes the guideline to thicken to make it easier to click.

If you click a guideline then it will expand / collapse the immediate children of the parent whose bullet the guideline is under according to the following rules:

- If any of the immediate children are open then all children will be closed.
- If all the children are closed then they will all be opened.

If is often easier to draw the guidelines by having the children draw a left border to represent that section of the guideline for each ancestor - this means the ancestors doesn't have to do complicated calculations about how to draw their own guidelines and calculate the appropriate height.  Hovering over any section of a guideline should highlight all corresponding sections.

### 2.2 Slide out side panel

At the top-left (web) or platform-appropriate entry point is an icon that toggles the visibility of a side panel that slides out from the left.
The side pane contains the following items
- A user profile picture in a circle followed by the name of the user. If the icon or name are clicked the profile dialog appears
- A settings option which if clicked opens the settings dialog
- An import option which if clicked pops up a sub-menu with two options
	- import Workflowy OPML
	- import Thortiq JSON
- An Export
If there is limited space the side panel floats over the top of the content area otherwise the side panel pushes the content area over and sits next to it with a space between them which the user can drag to resize the side panel.

## 3.  Cross device synchronisation
I have set up an AWS lightsail server, fronted by Caddy, to host the web app and websocket synchronisation server.

Although data is stored locally, and any client (web, desktop, android or iOS) can work offline, whenever the application is connected to the internet the sync server should ensure reliable, conflict free synchronisation across clients.

If two clients are connected at the same time then synchronisation should be near real-time.  

## 4. Undo / Redo

All local edits should pass through the same undo/redo manager.  This should include text edits, format changes and structural changes to the tree.  Undo / Redo should only apply to locally made edits, not remote edits applied by the sync server.

