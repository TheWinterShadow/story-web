# Story Web

An Obsidian plugin for quickly capturing plot points and campaign notes. Each one is a plain markdown note. Afterwards you can arrange, connect, and group them on an interactive graph.

- **Quick capture:** type a title and a one-line blurb, and you're done.
- **Card graph:** each note is a card showing its blurb, wrapped to a few lines (configurable). A coloured stripe marks its `type`. Click or tap a card to open the real note. Hovering a card highlights what it's connected to.
- **Manual connections:** in connect mode, tap a source note and then a target note. `[[wikilinks]]` in note bodies are shown automatically as dashed edges.
- **Groups:** right-click (or long-press on touch) a note → *Add to group…*. Notes that share a group are drawn inside a box.
- **Desktop and mobile:** built for iPad as well as desktop, including pinch-zoom, pan, drag, tap, and long-press.
- **No lock-in:** everything is stored in YAML frontmatter. If you disable the plugin, your notes are still ordinary markdown.

## Note format

Notes live in one configurable folder (default `Plots/`, including subfolders):

```yaml
---
blurb: "The vault is already empty when the crew breaks in"   # node label; falls back to the filename
type: fiction                                                 # optional; the graph can filter by it
group: Act 1                                                  # optional; notes sharing a group are boxed together
connects_to: ["[[Someone got there first]]"]                  # optional; manual edges, as wikilinks
x: 120                                                        # written by the plugin when you move a node
y: 340
---

The note body is yours. The plugin never modifies it.
```

Every field is optional. A note with no frontmatter still shows up, labelled with its filename. `type` can be any value you like, for example `fiction`, `campaign`, or `worldbuilding`.

## Using it

| Action | Desktop | Touch (iPad) |
|---|---|---|
| Open the graph | Ribbon icon or **Story Web: Open graph** | same |
| New plot point | **+ New** on the graph, **Story Web: New plot point** (bind a hotkey in Settings → Hotkeys), or the lightbulb ribbon icon | same |
| Open a note | Click (Cmd/Ctrl-click opens a new tab) | Tap |
| Move a node | Drag | Drag |
| Pan / zoom | Drag background / scroll wheel, or the zoom buttons bottom right | One-finger drag / pinch, or the zoom buttons |
| Fit everything in view | The frame button under the zoom buttons | same |
| Connect | **Connect** (top right), then click the note to start from, then the note it leads to | same, with taps. Or long-press a note → *Connect from here…* |
| Delete a manual connection | Select the edge, then press Delete, or right-click it | Long-press the edge |
| Group | Right-click a note → *Add to group…* | Long-press a note |
| Rename / dissolve a group | Right-click the group box | Long-press the group box |
| Leave connect mode | **Done** (the Connect button while active), or Esc | **Done** |

Clicking a note reuses an open note pane when there is one, so the graph stays put. A good setup is to keep the graph in one split and your notes in the other.

The first time you open the graph, notes without a position are laid out automatically, and those positions are saved. After that, new notes appear in the middle of what you're looking at, or next to their group.

## Settings

- **Folder:** where the notes live. It can't be the vault root, because the plugin writes positions into every note it lays out.
- **Default type:** the `type` added to notes created with quick capture.
- **Lines per card:** how many lines of blurb each card shows (1–6, default 3). Longer blurbs end in "…". Set it to 1 for compact one-line cards.
- **Open note after capture:** off by default, so capture doesn't interrupt what you're doing.

## Development

```bash
npm install
npm run dev      # watch build; also copies into test-vault/.obsidian/plugins/story-web
npm test         # unit tests (pure model + frontmatter logic)
npm run build    # typecheck + production bundle → main.js
```

Open `test-vault/` as a vault in Obsidian, enable community plugins, and Story Web loads with some sample notes. If you also install the [Hot Reload](https://github.com/pjeby/hot-reload) plugin in that vault, it reloads Story Web on every rebuild.

Don't point dev builds at a vault you care about until you've tested them. Use `STORY_WEB_VAULT_PLUGIN_DIR` to change where dev builds are copied.

### Releasing

```bash
npm version patch   # or minor / major: bumps package.json, manifest.json, versions.json and tags (no "v" prefix)
git push --follow-tags
```

The `Release` workflow builds from the tag and publishes a GitHub release with `main.js`, `manifest.json` and `styles.css` attached, which is what Obsidian installs from. It refuses to publish if the tag doesn't match `manifest.json`.

### Testing on iPad

Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/story-web/` on a vault that syncs to the iPad, then enable the plugin there. Or install it with BRAT (a plugin for installing betas from GitHub) using `TheWinterShadow/story-web`.

### Layout

```
src/
  main.ts         plugin entry: commands, ribbon, settings, view registration
  view.ts         ItemView + Cytoscape: rendering, diffing, gestures, menus
  store.ts        the only module that touches the vault (reads cache, writes frontmatter)
  model.ts        pure: notes → nodes/edges/groups (+ type filter)
  frontmatter.ts  pure: frontmatter mutations used inside processFrontMatter
  links.ts        pure: parsing `connects_to` wikilinks
  theme.ts        visual design: theme colours → Cytoscape stylesheet, type colours
  wrap.ts         pure: word-wrapping blurbs into card lines
  layout.ts       pure: initial column layout
  modals.ts       quick capture + text prompt
  settings.ts     settings + tab
tests/            vitest suites for the pure modules
docs/DECISIONS.md why things are the way they are
```

The view and store depend on Obsidian and can only be tested manually in the test vault. Everything that decides *what* to render or *what* to write is kept in the pure modules, so it can be unit tested.
