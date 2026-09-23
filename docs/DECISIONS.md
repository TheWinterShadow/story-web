# Decisions

Short architecture decision records. Newest last. Each entry: what, why, and what we gave up.

## 1. Custom `ItemView` + Cytoscape.js, not native Canvas

**Decision:** The graph is a custom view built on Obsidian's public plugin API (`ItemView`, `Vault`, `MetadataCache`, `FileManager`), rendered with Cytoscape.js. We do not read, write, or patch `.canvas` files or Canvas internals.

**Why:** Canvas has no public plugin API. Every plugin that extends it monkey-patches undocumented internals that break on routine Obsidian updates. The public API is stable. Cytoscape has solid touch support (pinch, pan, drag, tap threshold) and zero runtime dependencies. Juggl and Deterministic Graph View already use it inside Obsidian.

**Tradeoff:** We don't get Canvas's free-form cards, embeds, or its UI. Cards show only the blurb (a few lines at most), never the note body.

## 2. All state lives in note frontmatter

**Decision:** Position (`x`, `y`), grouping (`group`), manual edges (`connects_to` as wikilinks), and `type` are stored in each note's YAML frontmatter. Writes go only through `processFrontMatter`. Note bodies are never modified.

**Why:** There's no lock-in and no sidecar file that drifts out of sync. It works with any sync method, and diffs are readable in git. Uninstalling the plugin leaves valid markdown behind. Keeping `connects_to` as wikilinks means Obsidian's own link-rename handling keeps them valid.

**Tradeoff:** Dragging a node modifies a file, so layout changes show up in sync and git history. We mitigate this by rounding to whole pixels, writing only on drag *release*, and batching rapid drags into one write per note.

## 3. The folder can never be the vault root

**Decision:** The folder setting falls back to `Plots` if it is blank or `/`.

**Why:** The first time the view opens, the plugin lays out every unpositioned note and writes `x`/`y` into its frontmatter. Doing that to a whole vault by accident would add frontmatter to hundreds of unrelated notes.

## 4. Edges: manual vs. body links

**Decision:** Each directed note pair gets one edge. The plugin can delete an edge if it came from `connects_to` (drawn solid). If it only comes from a `[[wikilink]]` in the body, it is drawn dashed and is read-only.

**Why:** Removing a body link would mean editing prose, which breaks decision 2. The context menu tells the user to edit the note instead.

## 5. Connect gesture: tap source, then tap target, on every platform

**Decision:** In connect mode, tap (or click) a source node and then a target node. The node context menu also offers "Connect from here…". There's no drag-from-node-to-node gesture.

**Why:** On touch, dragging from a node already means "move the node", and dragging the background means "pan". A drag-to-connect gesture would conflict with both, or need a modifier key that iPad users don't have. Two taps work the same way with a mouse, a finger, or a pencil. That gives one code path and nothing to learn twice. Node dragging is switched off while connect mode is on, so a slightly shaky tap can't move anything.

**Tradeoff:** It's one extra step compared to drag-to-connect on desktop. If this feels slow in practice, the fix is to add `cytoscape-edgehandles` for mouse pointers only, and keep tap-tap for touch.

**Status:** Still needs testing on an iPad (open question 3 in the original spec).

## 6. Long-press menu is touch/pen only

**Decision:** `taphold` opens the context menu only when the last pointer was not a mouse. Mouse users get the menu from right-click (`cxttap`).

**Why:** Cytoscape also fires `taphold` for a mouse that is held still. That would pop up a menu when a desktop user pauses before dragging a node. After a long-press, the tap that fires on release is ignored, so opening the menu doesn't also open the note.

## 7. Fiction and campaign notes share one folder, split by `type`

**Decision:** There is one folder and one graph. The toolbar filters by `type`, and the filter's options come from whatever `type` values exist in the notes (nothing is hardcoded). Quick capture writes an optional default `type` from settings.

**Why:** It's simpler, and connections between the two kinds of notes stay possible. People who want separate graphs can open two views with different filters (the filter is saved per view).

## 8. Deterministic column layout for first open

**Decision:** Notes that have never been placed are laid out in columns: one per group (alphabetical), with ungrouped notes last. Cards are left-aligned and stacked by their actual height. Cytoscape's `cose` force layout is not used.

**Why:** `cose` overlapped nodes inside groups and wrote strange coordinates into frontmatter (e.g. `y: 14560`). A deterministic layout also means two devices opening the graph for the first time write the same positions, instead of conflicting ones.

## 9. Cards wrap their own text; Cytoscape doesn't size them

**Decision:** Blurbs are word-wrapped by `wrap.ts` using canvas text measurement and capped by the "Lines per card" setting, ending in "…". Card width and height are computed from the wrapped lines.

**Why:** Cytoscape's `width: 'label'` is deprecated and caches a zero width for some nodes, which silently hides them and their edges. Cytoscape can wrap text, but it can't limit the number of lines.

## 10. Type colours: hashed slot with collision probing

**Decision:** Each `type` gets one of Obsidian's eight theme colours (`--color-*`). Its preferred slot comes from a hash of its name. On a collision it takes the next free slot, with types processed alphabetically. Slots are computed from every type in the folder, not just the filtered ones.

**Why:** A plain hash sent `fiction` and `campaign` to the same colour. Assigning colours by position in a list would change every colour whenever a type was added. Probing keeps colours stable, distinct (up to eight types), identical on every device, and unchanged when you filter.

## 11. Controls live on the canvas, not in the view header

**Decision:** The primary actions (**+ New** and a **Connect** toggle) float at the top right of the graph with text labels. Zoom in, zoom out and fit sit in a map-style dock at the bottom right. Nothing is added to the view header. All controls use Obsidian's own button classes (`mod-cta`, `clickable-icon`) and theme variables, grow to 40px touch targets on mobile, and drop their labels when the pane is under 420px wide (via a container query).

**Why:** Icon-only header actions were ambiguous. "Fit" used the `maximize` icon, which reads as "fullscreen", and connect mode had no visible on/off state. On iPad, Obsidian can fold view-header actions into a "⋯" menu, hiding them. Now the Connect toggle switches to an accent-tinted **Done** while active (with `aria-pressed` set), so the mode is always visible and it's obvious how to leave it.

## 12. Lint with Obsidian's own review rules; TypeScript pinned to 6.0

**Decision:** `npm run lint` runs `eslint-plugin-obsidianmd`'s recommended config (ESLint core + typescript-eslint type-checked + Obsidian-specific rules), which is the rule set the community directory's automated review reports. CI and the release workflow both fail on lint errors. TypeScript is pinned to `~6.0`.

**Why:** Otherwise the only way to learn about review findings is to publish a release and wait for the directory to review it. Running the same rules locally catches them first. typescript-eslint's type-aware rules need TypeScript's JavaScript API, which the Go-based TypeScript 7 doesn't provide (typescript-eslint 8 supports `<6.1`). TS 7 offered nothing this project needs.

**Revisit:** Move to TypeScript 7 once typescript-eslint supports it.

**Settings:** the settings tab implements the 1.13 declarative API (`getSettingDefinitions`), so settings appear in Obsidian's settings search and the folder setting uses the native folder picker. `display()` stays as the fallback for Obsidian 1.7.2–1.12.
