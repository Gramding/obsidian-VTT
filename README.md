# Obsidian VTT Board

A Virtual Tabletop (VTT) plugin for Obsidian. Render a battle map, place character and monster tokens linked to your vault notes, and follow along with your initiative tracker in real time.

---

> **Disclaimer:** This plugin was entirely vibe coded in a single conversation with Claude. It works, but the code is what it is. No guarantees, no warranties, no warranty of fitness for any purpose including but not limited to slaying dragons. Back up your vault. You have been warned. It slaps though.

---

## Features

- Canvas-based battle map rendered inside an Obsidian leaf
- Square grid or Hex grid (flat-top or pointy-top), switchable mid-session
- Granular cell size slider (1px steps) — adjust the grid to match any map image
- Background map image with its own independent position and scale, separate from the grid overlay
- **Align BG mode** — drag and scroll to fit a pre-gridded map image under the overlay grid
- Tokens linked to vault notes, reading portrait, HP, color, and conditions from frontmatter
- Portrait images from the `portrait` frontmatter field — supports wikilinks like `[[goblin.png]]`
- Drag and drop tokens on the board, snap to grid
- Arrow key navigation for the selected token (Shift+arrow = jump by token size, Tab = cycle selection)
- HP bars, condition pips, token glow for selected token
- Zoom (scroll wheel, toward cursor) and pan (middle-click or drag empty space)
- Right-click context menu per token: open note, edit stats, refresh from note, remove
- Double-click a token to edit HP, size, and conditions inline
- **Load Encounter** — read an initiative-tracker encounter note and populate the board automatically
- **Follow Initiative** — subscribe to the initiative tracker's active combatant and smoothly pan to that token on every turn change
- All board state (token positions, background, grid settings) persisted between sessions

---

## Installation

1. Download or clone this repo.
2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```
3. Copy the plugin folder into your vault:
   ```
   <your-vault>/.obsidian/plugins/obsidian-vtt/
   ```
   The folder needs at minimum `main.js` and `manifest.json`.
4. In Obsidian: **Settings > Community Plugins**, enable **VTT Board**.

A grid icon will appear in the ribbon. Click it to open the board.

---

## Token Notes (Frontmatter)

Tokens are created from vault markdown notes. The plugin reads these frontmatter fields:

| Field | Type | Description |
|---|---|---|
| `portrait` | string or wikilink | Image to display on token. Accepts `[[goblin.png]]`, `[[folder/goblin.png\|alias]]`, or a plain vault path. |
| `name` | string | Display name on the token. Falls back to the note filename. |
| `type` | `character` or `monster` | Token type. |
| `hp` | number | Current hit points. |
| `maxHp` or `max-hp` | number | Max HP. Shows a color-coded bar under the token. |
| `size` | number | Footprint in grid cells. `1` = 1×1, `2` = 2×2 (Large), etc. Default `1`. |
| `color` | hex string | Token border color, e.g. `"#e74c3c"`. Auto-assigned if omitted. |
| `conditions` | list | Conditions shown as letter pips, e.g. `[poisoned, prone]`. |

### Example

```yaml
---
name: Thorin Ironforge
type: character
portrait: "[[thorin.png]]"
hp: 45
maxHp: 52
size: 1
color: "#3498db"
conditions:
  - blessed
---
```

---

## Controls

| Action | Input |
|---|---|
| Pan the board | Middle-click drag, or left-click drag on empty space |
| Zoom | Scroll wheel (toward cursor) |
| Select token | Left-click |
| Drag token | Left-click drag on token |
| Move selected token | Arrow keys (Shift = step by token size) |
| Cycle token selection | Tab / Shift+Tab |
| Deselect | Escape |
| Context menu | Right-click on token |
| Edit token stats | Double-click on token |

---

## Toolbar

| Button | What it does |
|---|---|
| ⊕ Add Token | Fuzzy-search your vault notes and add one as a token |
| 📜 Load Encounter | Read the currently active note as an initiative-tracker encounter and populate the board |
| 🖼 Background | Pick a map image from your vault |
| ✖🖼 Clear BG | Remove the background image |
| 🎯 Align BG | Enter Align-BG mode to reposition and scale the background image independently |
| ↺🖼 Reset BG | Reset background position and scale to default |
| Grid type dropdown | Switch between Square, Hex Flat, Hex Pointy |
| Cell slider | Set grid cell size in pixels (1px steps, 10–200px) |
| 👁 Grid | Toggle grid overlay |
| ⟳ Reset View | Reset pan and zoom to origin |
| ⚔️ Follow Initiative | Subscribe to the Initiative Tracker and pan to the active combatant on each turn |
| 🗑 Clear Board | Remove all tokens from the board |

---

## Align BG Mode

When a map image has its own grid baked in, you need to align that image so its squares line up with the VTT overlay grid. Click **🎯 Align BG** to enter this mode:

- **Drag** to move the image
- **Scroll** to scale the image (zooms toward the cursor, same feel as viewport zoom)
- **Shift+Scroll** for fine-scale control (10x slower)
- A dashed purple border shows the image bounds and a readout shows the current scale and offset
- Click **🎯 Align BG** again or double-click to exit

Position and scale are saved automatically. **↺🖼 Reset BG** puts it back to `(0, 0, scale 1)`.

---

## Loading an Encounter Note

Add `map` and `players` to a note's frontmatter, then add an `encounter` code block (initiative-tracker format):

```yaml
---
map: "[[dungeon-level1.jpg]]"
players:
  - "[[Thorin Ironforge]]"
  - "[[Aria Swiftwind]]"
---
```

````
```encounter
name: Goblin Ambush
creatures:
  - 3: Goblin, 7, 15, 2
  - 1: Hobgoblin, 18, 16, 1
  - 2:
      creature: Goblin
      name: Goblin Shaman
      hp: 10
      ac: 12
```
````

With this note open, click **📜 Load Encounter** (or run the command `VTT: Load encounter from active note`). The board will:

- Clear existing tokens and background
- Set the map from the `map` frontmatter field
- Add player tokens by looking up each name as a vault note (portrait and stats pulled from frontmatter)
- Add creature tokens — if a vault note with that creature's name exists, it uses the portrait from there; otherwise an anonymous colored token is created with the HP and AC from the encounter block
- Numbered tokens automatically: three Goblins become "Goblin 1", "Goblin 2", "Goblin 3"

Supported creature line formats match the full initiative-tracker spec: plain name, `name, hp, ac, mod`, `N: name`, `[[Creature, Alias]]`, and the YAML object form with `creature:`/`name:`/`hp:`/`ac:`.

---

## Follow Initiative

Click **⚔️ Follow Initiative** to turn on follow mode (button turns green). The plugin subscribes to the Initiative Tracker's Svelte store and on every turn change smoothly animates (400ms ease-out) the board viewport to center on the active combatant's token.

- Deduplicates by combatant ID so three "Goblin" entries each trigger their own pan
- Uses the `display` name field when set (e.g. "Goblin Shaman")
- Matches numbered VTT tokens ("Goblin 1", "Goblin 2") to the correct rank in the IT list
- Click the button again to stop following

Requires the [Initiative Tracker](https://github.com/Obsidian-TTRPG-Community/initiative-tracker) plugin (tested on v13.x).

---

## Settings

Available under **Settings > VTT Board**:

- Default grid type
- Default cell size
- Grid dimensions (columns and rows)
- Grid color and opacity

All other board state (background image, token positions, zoom, etc.) is saved automatically.

---

## Known Limitations

- No fog of war
- No line-of-sight or lighting
- Token order on the board and in the IT list need to match for the rank-based follow logic to work correctly — loading both from the same encounter note guarantees this
- The Follow Initiative rank mapping assumes the token list order on the board matches the combatant order in the initiative tracker
- This was vibe coded. There are almost certainly bugs.
