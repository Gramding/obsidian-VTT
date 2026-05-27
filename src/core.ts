// Constants, board defaults, and pure helper functions.

import type { BoardSettings, BoardState, VTTSettings, BestiaryMonster } from "./types";

export const VTT_VIEW_TYPE = "vtt-board";
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];

export const DEFAULT_BOARD: BoardSettings = {
  gridType: "square",
  cellSize: 64,
  cols: 20,
  rows: 15,
  backgroundImage: null,
  bgX: 0,
  bgY: 0,
  bgScale: 1,
  showGrid: true,
  gridColor: "#4a9eff",
  gridOpacity: 0.3,
};

export function makeBoard(name: string): BoardState {
  return { name, board: { ...DEFAULT_BOARD }, tokens: [] };
}

export const DEFAULT_SETTINGS: VTTSettings = {
  boards: [makeBoard("Board 1")],
  activeBoardIndex: 0,
};

const TOKEN_COLORS = [
  "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71",
  "#1abc9c", "#3498db", "#9b59b6", "#e91e63",
];
let colorCursor = 0;
export const nextColor = () => TOKEN_COLORS[colorCursor++ % TOKEN_COLORS.length];

/** Extract a plain AC number from the ac field which can be int or [{ac:N,...}] */
export function resolveAC(ac: BestiaryMonster["ac"]): number | null {
  if (!ac) return null;
  if (typeof ac === "number") return ac;
  if (Array.isArray(ac) && ac.length > 0) {
    const first = ac[0];
    if (typeof first === "number") return first;
    if (typeof first === "object" && "ac" in first) return (first as {ac:number}).ac;
  }
  return null;
}
