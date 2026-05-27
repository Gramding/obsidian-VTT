// Shared data types for the VTT plugin. Pure type declarations — no runtime.

export interface Token {
  id: string;
  filePath: string;
  name: string;
  portrait: string | null;
  col: number;
  row: number;
  size: number; // footprint in grid cells
  type: "character" | "monster" | "unknown";
  color: string;
  hp?: number;
  maxHp?: number;
  conditions: string[];
  defeated?: boolean; // greyed out with X, still on board
}

export interface BoardSettings {
  gridType: "square" | "hex-flat" | "hex-pointy";
  /** World-space size of one grid cell. Never changed by viewport zoom. */
  cellSize: number;
  cols: number;
  rows: number;

  // Background image — stored path for reload
  backgroundImage: string | null;
  /**
   * Background transform, independent of the grid.
   * The image is drawn at world position (bgX, bgY) with its natural pixel
   * dimensions multiplied by bgScale.  Adjust these to line up a pre-gridded
   * map image with the overlay grid.
   */
  bgX: number;
  bgY: number;
  bgScale: number;

  showGrid: boolean;
  gridColor: string;
  gridOpacity: number;
}

export interface BoardState {
  name: string;
  board: BoardSettings;
  tokens: Token[];
}

export interface VTTSettings {
  boards: BoardState[];
  activeBoardIndex: number;
}

export type InteractMode = "normal" | "align-bg";

export interface EncounterCreature {
  /** Bestiary name — used for vault-note lookup */
  creature: string;
  /** Display name (may differ from creature) */
  name: string;
  hp:   number | null;
  ac:   number | null;
  mod:  number | null;
  /** How many copies of this creature */
  count: number;
}

export interface ParsedEncounter {
  /** Resolved resource URL for the background map, or null */
  mapUrl:    string | null;
  /** Raw player names / note-paths from frontmatter */
  players:   string[];
  creatures: EncounterCreature[];
}

export interface BestiaryMonster {
  name:     string;
  hp?:      number;
  ac?:      number | { ac: number }[];
  cr?:      string | number;
  type?:    string;
  subtype?: string;
  size?:    string;
  source?:  string;
}

export interface BuilderCreature {
  creature: string;     // bestiary/note name
  displayName: string;  // shown on token
  hp: string;
  ac: string;
  count: number;
}
