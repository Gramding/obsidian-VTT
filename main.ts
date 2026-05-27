import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
  ItemView,
  TFile,
  Notice,
  Modal,
  FuzzySuggestModal,
  setIcon,
} from "obsidian";

// ─── Constants ────────────────────────────────────────────────────────────────

const VTT_VIEW_TYPE = "vtt-board";
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Token {
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

interface BoardSettings {
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

interface BoardState {
  name: string;
  board: BoardSettings;
  tokens: Token[];
}

interface VTTSettings {
  boards: BoardState[];
  activeBoardIndex: number;
}

const DEFAULT_BOARD: BoardSettings = {
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

const DEFAULT_SETTINGS: VTTSettings = {
  boards: [makeBoard("Board 1")],
  activeBoardIndex: 0,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TOKEN_COLORS = [
  "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71",
  "#1abc9c", "#3498db", "#9b59b6", "#e91e63",
];
let colorCursor = 0;
export const nextColor = () => TOKEN_COLORS[colorCursor++ % TOKEN_COLORS.length];

// ─── Modals ───────────────────────────────────────────────────────────────────

class NoteSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private cb: (f: TFile) => void) {
    super(app);
    this.setPlaceholder("Search for a character or monster note...");
  }
  getItems() { return this.app.vault.getMarkdownFiles(); }
  getItemText(f: TFile) { return f.path; }
  onChooseItem(f: TFile) { this.cb(f); }
}

class ImageSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private cb: (f: TFile) => void) {
    super(app);
    this.setPlaceholder("Search for an image file...");
  }
  getItems() {
    return this.app.vault.getFiles().filter(
      f => IMAGE_EXTENSIONS.includes(f.extension.toLowerCase())
    );
  }
  getItemText(f: TFile) { return f.path; }
  onChooseItem(f: TFile) { this.cb(f); }
}

class ConfirmModal extends Modal {
  constructor(app: App, private msg: string, private onOk: () => void) { super(app); }
  onOpen() {
    const { contentEl } = this;
    contentEl.style.cssText = "font-family:'Courier New',monospace;padding:8px;";
    contentEl.createEl("p", { text: this.msg }).style.color = "#e0e8ff";
    const row = contentEl.createDiv();
    row.style.cssText = "display:flex;gap:8px;margin-top:12px;";
    const b = (label: string, bg: string, fn: () => void) => {
      const el = row.createEl("button", { text: label });
      el.style.cssText = `background:${bg};border:none;border-radius:4px;color:#fff;padding:6px 16px;cursor:pointer;font-family:inherit;`;
      el.onclick = fn;
    };
    b("Confirm", "#e74c3c", () => { this.onOk(); this.close(); });
    b("Cancel",  "#2a3450", () => this.close());
  }
  onClose() { this.contentEl.empty(); }
}

class TokenDetailModal extends Modal {
  constructor(app: App, private token: Token, private onSave: () => void) { super(app); }
  onOpen() {
    const { contentEl, token } = this;
    contentEl.style.cssText = "font-family:'Courier New',monospace;color:#a0b4d0;";
    contentEl.createEl("h2", { text: `Edit: ${token.name}` }).style.color = "#e0e8ff";

    const row = (label: string, el: HTMLElement) => {
      const w = contentEl.createDiv();
      w.style.cssText = "display:flex;align-items:center;gap:10px;margin:8px 0;";
      const l = w.createEl("label", { text: label });
      l.style.cssText = "width:80px;font-size:12px;flex-shrink:0;";
      w.appendChild(el);
    };
    const num = (v: number | undefined) => {
      const el = document.createElement("input");
      el.type = "number"; el.value = v !== undefined ? String(v) : "";
      el.style.cssText = "background:#1e2535;border:1px solid #2a3450;border-radius:4px;color:#e0e8ff;padding:4px 8px;width:120px;";
      return el;
    };
    const txt = (v: string) => {
      const el = document.createElement("input");
      el.type = "text"; el.value = v;
      el.style.cssText = "background:#1e2535;border:1px solid #2a3450;border-radius:4px;color:#e0e8ff;padding:4px 8px;width:200px;";
      return el;
    };

    const nameIn  = txt(token.name);
    const hpIn    = num(token.hp);
    const maxHpIn = num(token.maxHp);
    const sizeIn  = num(token.size);
    const condIn  = txt(token.conditions.join(", "));
    row("Name", nameIn); row("HP", hpIn); row("Max HP", maxHpIn);
    row("Size", sizeIn); row("Conditions", condIn);

    const save = contentEl.createEl("button", { text: "Save" });
    save.style.cssText = "margin-top:12px;background:#4a9eff;border:none;border-radius:4px;color:#fff;padding:6px 20px;cursor:pointer;font-family:inherit;";
    save.onclick = () => {
      token.name = nameIn.value.trim() || token.name;
      const ph = parseInt(hpIn.value), pm = parseInt(maxHpIn.value);
      token.hp    = isNaN(ph) ? undefined : ph;
      token.maxHp = isNaN(pm) ? undefined : pm;
      token.size  = Math.max(1, parseInt(sizeIn.value) || 1);
      token.conditions = condIn.value.split(",").map(s => s.trim()).filter(Boolean);
      this.onSave(); this.close();
    };
  }
  onClose() { this.contentEl.empty(); }
}


// ─── Board Suggest Modal ──────────────────────────────────────────────────────

class BoardSuggestModal extends FuzzySuggestModal<BoardState> {
  constructor(
    app: App,
    private boards: BoardState[],
    private onChoose: (board: BoardState, index: number) => void,
  ) {
    super(app);
    this.setPlaceholder("Switch board...");
  }
  getItems() { return this.boards; }
  getItemText(b: BoardState) { return b.name; }
  renderSuggestion(item: {item: BoardState; match: any}, el: HTMLElement) {
    el.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px;";
    const left = el.createDiv();
    left.style.cssText = "display:flex;align-items:center;gap:8px;min-width:0;";
    const iconWrap = left.createDiv();
    iconWrap.style.cssText = "display:flex;align-items:center;color:var(--text-accent);flex-shrink:0;";
    setIcon(iconWrap, "layout-grid");
    const name = left.createDiv({ text: item.item.name });
    name.style.cssText = "color:var(--text-normal);font-size:var(--font-ui-small);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    const count = el.createDiv({ text: `${item.item.tokens.length} tokens` });
    count.style.cssText = "font-size:var(--font-ui-smaller);color:var(--text-faint);flex-shrink:0;";
  }
  onChooseItem(b: BoardState) {
    const idx = this.boards.indexOf(b);
    this.onChoose(b, idx);
  }
}

// ─── VTT View ─────────────────────────────────────────────────────────────────

type InteractMode = "normal" | "align-bg";

class VTTView extends ItemView {
  private plugin: VTTPlugin;
  private get vts()   { return this.plugin.vttSettings; }
  // Active board state — all token/board access goes through here
  private get S()     { return this.vts.boards[this.vts.activeBoardIndex] ?? this.vts.boards[0]; }
  private get board() { return this.S.board; }

  // board switcher button
  private boardBtn: HTMLElement | null = null;

  private canvas!: HTMLCanvasElement;
  private ctx!:    CanvasRenderingContext2D;
  private wrap!:   HTMLElement;

  // image cache
  private imgCache   = new Map<string, HTMLImageElement>();
  private imgLoading = new Set<string>();

  // viewport transform (runtime only, never persisted)
  private panX = 0;
  private panY = 0;
  private zoom = 1;

  // current interaction mode
  private mode: InteractMode = "normal";

  // panning state (shared between modes, target differs)
  private isPanning  = false;
  private panAnchorX = 0;
  private panAnchorY = 0;
  // bg pan anchor stores bgX/bgY at drag start
  private bgPanStartX = 0;
  private bgPanStartY = 0;

  // token drag
  private dragToken: Token | null = null;
  private dragOffX  = 0;
  private dragOffY  = 0;
  // multi-selection
  private selTokens = new Set<Token>();
  // drag offsets for each selected token (id -> {dcol, drow})
  private dragOffsets = new Map<string, {x:number, y:number}>();
  // measurement tool state
  private measuring    = false;
  private measureStart: {x:number,y:number} | null = null;
  private measureEnd:   {x:number,y:number} | null = null;
  private measureBtnEl: HTMLElement | null = null;
  // quick HP edit state
  private hpEditToken: Token | null = null;
  private hpEditEl:    HTMLElement | null = null;

  // ui
  private ctxMenu:     HTMLElement | null = null;
  private alignBtnEl:  HTMLElement | null = null;
  private alignHint:   HTMLElement | null = null;

  private animId: number | null = null;
  private dirty = true;

  // ── Follow-initiative state ───────────────────────────────────────────────
  private followActive   = false;      // whether follow mode is on
  private followInterval: number | null = null;
  private lastFollowId   = "";         // last combatant ID we focused, avoids redundant pans
  private followBtnEl:  HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: VTTPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType()    { return VTT_VIEW_TYPE; }
  getDisplayText() { return "VTT Board"; }
  getIcon()        { return "layout-grid"; }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async onOpen()  {
    this.buildUI();
    this.startLoop();
    // Re-fit grid to background on open in case cols/rows are stale from a different session
    if (this.board.backgroundImage) {
      this.fitGridToImage(this.board.backgroundImage);
    }
  }
  async onClose() {
    if (this.animId !== null) { cancelAnimationFrame(this.animId); this.animId = null; }
    this.stopFollow();
    this.closeCtxMenu();
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  buildUI() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.style.cssText =
      "display:flex;flex-direction:column;height:100%;background:var(--background-primary);overflow:hidden;";

    this.buildToolbar(containerEl);
    this.buildAlignHint(containerEl);

    this.wrap = containerEl.createDiv();
    this.wrap.style.cssText = "flex:1;position:relative;overflow:hidden;";

    this.canvas = this.wrap.createEl("canvas");
    this.canvas.style.cssText = "position:absolute;top:0;left:0;display:block;touch-action:none;";
    this.ctx = this.canvas.getContext("2d")!;

    this.resizeCanvas();
    this.attachEvents();
    new ResizeObserver(() => { this.resizeCanvas(); this.dirty = true; }).observe(this.wrap);
  }

  buildAlignHint(parent: HTMLElement) {
    const hint = parent.createDiv();
    hint.style.cssText =
      "display:none;align-items:center;gap:8px;padding:4px 12px;" +
      "background:var(--background-modifier-hover);border-bottom:1px solid var(--background-modifier-border);" +
      "color:var(--text-muted);font-size:var(--font-ui-smaller);flex-shrink:0;";
    const icon = hint.createDiv();
    setIcon(icon, "crosshair");
    icon.style.cssText = "display:flex;align-items:center;color:var(--interactive-accent);flex-shrink:0;";
    hint.createSpan({ text: "Align BG — drag: move image  |  scroll: scale  |  Shift+scroll: fine-scale  |  click Align BG again to exit" });
    this.alignHint = hint;
  }

  buildToolbar(parent: HTMLElement) {
    const bar = parent.createDiv();
    bar.style.cssText =
      "display:flex;align-items:center;gap:2px;padding:3px 6px;" +
      "background:var(--titlebar-background);border-bottom:1px solid var(--background-modifier-border);" +
      "flex-wrap:wrap;flex-shrink:0;";

    // Icon-only button using Obsidian's clickable-icon pattern
    const btn = (iconId: string, tip: string, fn: () => void): HTMLElement => {
      const b = bar.createDiv({ cls: "clickable-icon vtt-toolbar-btn" });
      b.setAttribute("aria-label", tip);
      b.style.cssText = "display:flex;align-items:center;justify-content:center;padding:4px;border-radius:4px;cursor:pointer;color:var(--icon-color);";
      setIcon(b, iconId);
      b.title = tip;
      b.onclick = fn;
      return b;
    };

    const sep = () => {
      const d = bar.createDiv();
      d.style.cssText = "width:1px;height:16px;background:var(--background-modifier-border);margin:0 3px;flex-shrink:0;";
    };

    // ── Board switcher ────────────────────────────────────────────────────
    const boardBtn = bar.createEl("button");
    boardBtn.style.cssText =
      "display:flex;align-items:center;gap:5px;max-width:160px;min-width:80px;" +
      "background:var(--background-primary);border:1px solid var(--background-modifier-border);" +
      "border-radius:var(--radius-s);color:var(--text-normal);padding:3px 8px;cursor:pointer;" +
      "font-size:var(--font-ui-smaller);height:26px;overflow:hidden;";
    const boardBtnIcon = boardBtn.createSpan();
    boardBtnIcon.style.cssText = "display:flex;align-items:center;flex-shrink:0;";
    setIcon(boardBtnIcon, "layout-grid");
    const boardBtnLabel = boardBtn.createSpan({ text: this.S.name });
    boardBtnLabel.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    boardBtn.title = "Switch board (click to search)";
    boardBtn.onmouseenter = () => { boardBtn.style.borderColor = "var(--interactive-accent)"; };
    boardBtn.onmouseleave = () => { boardBtn.style.borderColor = "var(--background-modifier-border)"; };
    boardBtn.onclick = () => {
      new BoardSuggestModal(this.app, this.vts.boards, async (_board, idx) => {
        this.vts.activeBoardIndex = idx;
        this.plugin.saveVTTSettings();
        this.resetViewport();
        this.rebuildBoardSel();
        this.dirty = true;
        await this.plugin.loadITForBoard(this.vts.boards[idx].name);
      }).open();
    };
    this.boardBtn = boardBtn;
    btn("plus",    "New board",            () => {
      const name = `Board ${this.vts.boards.length + 1}`;
      this.vts.boards.push(makeBoard(name));
      this.vts.activeBoardIndex = this.vts.boards.length - 1;
      this.plugin.saveVTTSettings();
      this.rebuildBoardSel();
      this.resetViewport();
      this.dirty = true;
    });
    btn("pencil",  "Rename current board", () => {
      new RenameBoardModal(this.app, this.S.name, (name) => {
        this.S.name = name;
        this.plugin.saveVTTSettings();
        this.rebuildBoardSel();
      }).open();
    });
    btn("x",       "Delete current board", () => {
      if (this.vts.boards.length <= 1) { new Notice("Cannot delete the only board."); return; }
      new ConfirmModal(this.app, `Delete board "${this.S.name}"?`, () => {
        this.vts.boards.splice(this.vts.activeBoardIndex, 1);
        this.vts.activeBoardIndex = Math.min(this.vts.activeBoardIndex, this.vts.boards.length - 1);
        this.plugin.saveVTTSettings();
        this.rebuildBoardSel();
        this.selTokens.clear(); this.dragToken = null;
        this.resetViewport(); this.dirty = true;
      }).open();
    });

    sep();

    // ── Tokens ────────────────────────────────────────────────────────────
    btn("user-plus",      "Add token",                     () => this.openAddToken());
    btn("list-plus",      "New encounter note",            () => new EncounterBuilderModal(this.app, this.plugin).open());
    btn("play",           "Load encounter from active note", () => this.plugin.loadEncounterFromActiveNote());
    const followBtn = btn("swords", "Follow Initiative Tracker (toggle)", () => this.toggleFollow());
    this.followBtnEl = followBtn;

    sep();

    // Background
    btn("image",          "Set background map image",      () => this.pickBackground());
    btn("image-off",      "Clear background image",        () => {
      this.board.backgroundImage = null;
      this.plugin.saveVTTSettings();
      this.dirty = true;
    });
    const alignBtn = btn("move",  "Align background image (toggle)",
      () => this.toggleAlignMode()
    );
    this.alignBtnEl = alignBtn;
    btn("rotate-ccw",     "Reset background position and scale", () => {
      this.board.bgX = 0; this.board.bgY = 0; this.board.bgScale = 1;
      this.plugin.saveVTTSettings();
      this.dirty = true;
    });

    sep();

    // Grid type select — keep as select, style natively
    const sel = bar.createEl("select");
    sel.style.cssText =
      "background:var(--background-primary);border:1px solid var(--background-modifier-border);" +
      "border-radius:var(--radius-s);color:var(--text-normal);padding:3px 6px;cursor:pointer;" +
      "font-size:var(--font-ui-smaller);height:26px;";
    ([
      ["square",     "Squares"],
      ["hex-flat",   "Hex Flat"],
      ["hex-pointy", "Hex Pointy"],
    ] as const).forEach(([v, l]) => {
      const o = sel.createEl("option", { text: l, value: v });
      if (v === this.board.gridType) o.selected = true;
    });
    sel.onchange = () => {
      this.board.gridType = sel.value as BoardSettings["gridType"];
      this.plugin.saveVTTSettings();
      this.dirty = true;
    };

    sep();

    // Cell size slider
    const szW = bar.createDiv();
    szW.style.cssText = "display:flex;align-items:center;gap:4px;color:var(--text-muted);font-size:var(--font-ui-smaller);";
    szW.createSpan({ text: "Cell" });
    const szIn = szW.createEl("input", { type: "range" });
    szIn.min = "10"; szIn.max = "200"; szIn.step = "1";
    szIn.value = String(this.board.cellSize);
    szIn.style.cssText = "width:80px;accent-color:var(--interactive-accent);cursor:pointer;";
    const szLbl = szW.createSpan({ text: `${this.board.cellSize}px` });
    szLbl.style.cssText = "min-width:30px;color:var(--text-muted);font-size:var(--font-ui-smaller);";
    szIn.oninput = () => {
      this.board.cellSize = parseInt(szIn.value);
      szLbl.textContent   = `${szIn.value}px`;
      this.plugin.saveVTTSettings();
      this.dirty = true;
    };

    sep();

    const measureBtn = btn("ruler",  "Measure distance (click-drag on board)", () => {
      this.measuring = !this.measuring;
      if (!this.measuring) { this.measureStart = null; this.measureEnd = null; }
      this.measureBtnEl = measureBtn;
      measureBtn.style.color      = this.measuring ? "var(--interactive-accent)" : "var(--icon-color)";
      measureBtn.style.background = this.measuring ? "var(--background-modifier-hover)" : "";
      this.dirty = true;
    });
    btn("grid",         "Toggle grid overlay",             () => {
      this.board.showGrid = !this.board.showGrid;
      this.plugin.saveVTTSettings();
      this.dirty = true;
    });
    btn("focus",        "Reset viewport pan and zoom",     () => {
      this.panX = 0; this.panY = 0; this.zoom = 1; this.dirty = true;
    });

    sep();

    btn("trash-2",      "Clear all tokens from board",    () => {
      new ConfirmModal(this.app, "Remove all tokens from the board?", () => {
        this.S.tokens = [];
        this.selTokens.clear(); this.dragToken = null;
        this.plugin.saveVTTSettings();
        this.dirty = true;
      }).open();
    });
  }

  // ── Align-BG mode ─────────────────────────────────────────────────────────

  toggleAlignMode() {
    if (this.mode === "align-bg") {
      this.setMode("normal");
    } else {
      if (!this.board.backgroundImage) {
        new Notice("Set a background image first.");
        return;
      }
      this.setMode("align-bg");
    }
  }

  setMode(m: InteractMode) {
    this.mode = m;
    const active = m === "align-bg";

    if (this.alignHint) {
      this.alignHint.style.display = active ? "flex" : "none";
    }
    if (this.alignBtnEl) {
      this.alignBtnEl.style.color      = active ? "var(--interactive-accent)" : "var(--icon-color)";
      this.alignBtnEl.style.background = active ? "var(--background-modifier-hover)" : "";
    }
    this.canvas.style.cursor = active ? "move" : "default";
    this.dirty = true;
  }

  // ── Canvas ────────────────────────────────────────────────────────────────

  resizeCanvas() {
    this.canvas.width  = this.wrap.clientWidth;
    this.canvas.height = this.wrap.clientHeight;
  }

  startLoop() {
    const tick = () => {
      if (this.dirty) { this.render(); this.dirty = false; }
      this.animId = requestAnimationFrame(tick);
    };
    this.animId = requestAnimationFrame(tick);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  //
  //  World-space layout:
  //    - The GRID lives at world (0,0).  One cell = cellSize × cellSize px.
  //    - The BACKGROUND IMAGE lives at world (bgX, bgY) and is rendered with
  //      dimensions (img.naturalWidth * bgScale) × (img.naturalHeight * bgScale).
  //    - These two transforms are completely independent.  Adjust bgX/bgY/bgScale
  //      in Align-BG mode to make a pre-gridded map line up with the overlay.
  //    - The VIEWPORT applies a single translate+scale on top of everything.

  render() {
    const { ctx, canvas, board } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0d0f14";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // ── Background (its own independent world transform) ──────────────────
    if (board.backgroundImage) {
      const img = this.loadImg(board.backgroundImage);
      if (img) {
        const iw = img.naturalWidth  * board.bgScale;
        const ih = img.naturalHeight * board.bgScale;
        ctx.drawImage(img, board.bgX, board.bgY, iw, ih);

        // In align-bg mode draw a dashed border so the user can see the image bounds
        if (this.mode === "align-bg") {
          ctx.save();
          ctx.strokeStyle = "#a855f7";
          ctx.lineWidth   = 2 / this.zoom;
          ctx.setLineDash([8 / this.zoom, 4 / this.zoom]);
          ctx.strokeRect(board.bgX, board.bgY, iw, ih);
          ctx.restore();
        }
      } else {
        // Placeholder — draw at grid size so something visible appears
        const gw = board.cols * board.cellSize;
        const gh = board.rows * board.cellSize;
        ctx.fillStyle = "#1a1f2e";
        ctx.fillRect(0, 0, gw, gh);
        ctx.fillStyle = "#3a4460";
        ctx.font = `${Math.max(12, board.cellSize * 0.28)}px 'Courier New'`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Loading map...", gw / 2, gh / 2);
      }
    } else {
      // No background: draw a plain dark rectangle the size of the grid
      ctx.fillStyle = "#1a1f2e";
      ctx.fillRect(0, 0, board.cols * board.cellSize, board.rows * board.cellSize);
    }

    // ── Grid ──────────────────────────────────────────────────────────────
    // Grid is always at world origin (0,0), independent of background.
    if (board.showGrid) {
      const lw = 1 / this.zoom;
      if (board.gridType === "square") this.drawSquareGrid(lw);
      else this.drawHexGrid(lw);
    }

    // ── Tokens ────────────────────────────────────────────────────────────
    // Tokens snap to the grid, so they live in grid-world coords too.
    for (const t of this.S.tokens) {
      if (t !== this.dragToken) this.drawToken(t);
    }
    if (this.dragToken) this.drawToken(this.dragToken);

    // ── Measurement line ──────────────────────────────────────────────────────
    if (this.measuring && this.measureStart && this.measureEnd) {
      this.drawMeasurement(this.measureStart, this.measureEnd);
    }

    // ── Align-BG mode overlay info ────────────────────────────────────────
    if (this.mode === "align-bg" && board.backgroundImage) {
      this.drawAlignInfo();
    }

    ctx.restore();
  }

  drawAlignInfo() {
    const { ctx, board, zoom } = this;
    const img = this.imgCache.get(board.backgroundImage!);
    if (!img) return;

    const iw = img.naturalWidth  * board.bgScale;
    const ih = img.naturalHeight * board.bgScale;

    // scale readout in top-left of image
    ctx.save();
    ctx.font = `${12 / zoom}px 'Courier New'`;
    const txt = `scale ${board.bgScale.toFixed(3)}  offset (${Math.round(board.bgX)}, ${Math.round(board.bgY)})`;
    const tw  = ctx.measureText(txt).width;
    const tx  = board.bgX + 6 / zoom;
    const ty  = board.bgY + 6 / zoom;
    ctx.fillStyle = "rgba(74,29,150,0.82)";
    ctx.fillRect(tx - 3 / zoom, ty - 2 / zoom, tw + 6 / zoom, 16 / zoom);
    ctx.fillStyle = "#e9d5ff";
    ctx.textAlign    = "left";
    ctx.textBaseline = "top";
    ctx.fillText(txt, tx, ty);
    ctx.restore();
  }

  // ── Grid drawing ──────────────────────────────────────────────────────────

  drawSquareGrid(lw: number) {
    const { ctx, board } = this;
    const { cols, rows, cellSize, gridColor, gridOpacity } = board;
    ctx.save();
    ctx.globalAlpha = gridOpacity;
    ctx.strokeStyle = gridColor;
    ctx.lineWidth   = lw;
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) {
      ctx.moveTo(c * cellSize, 0);
      ctx.lineTo(c * cellSize, rows * cellSize);
    }
    for (let r = 0; r <= rows; r++) {
      ctx.moveTo(0,              r * cellSize);
      ctx.lineTo(cols * cellSize, r * cellSize);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawHexGrid(lw: number) {
    const { ctx, board } = this;
    const { cols, rows, cellSize, gridColor, gridOpacity, gridType } = board;
    const pointy = gridType === "hex-pointy";
    const r      = cellSize / 2;
    ctx.save();
    ctx.globalAlpha = gridOpacity;
    ctx.strokeStyle = gridColor;
    ctx.lineWidth   = lw;
    ctx.beginPath();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const { x, y } = this.hexCenter(col, row, r, pointy);
        this.hexPath(x, y, r, pointy);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  hexCenter(col: number, row: number, r: number, pointy: boolean) {
    if (pointy) {
      const w = Math.sqrt(3) * r, h = 2 * r;
      return { x: col * w + (row % 2 ? w / 2 : 0) + w / 2, y: row * h * 0.75 + r };
    }
    const w = 2 * r, h = Math.sqrt(3) * r;
    return { x: col * w * 0.75 + r, y: row * h + (col % 2 ? h / 2 : 0) + h / 2 };
  }

  hexPath(cx: number, cy: number, r: number, pointy: boolean) {
    const off = pointy ? Math.PI / 6 : 0;
    this.ctx.moveTo(cx + r * Math.cos(off), cy + r * Math.sin(off));
    for (let i = 1; i < 6; i++) {
      const a = Math.PI / 3 * i + off;
      this.ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    this.ctx.closePath();
  }

  // ── Token drawing ─────────────────────────────────────────────────────────

  drawToken(token: Token) {
    const { ctx, board } = this;
    const isHex  = board.gridType !== "square";
    const pointy = board.gridType === "hex-pointy";
    const r      = board.cellSize / 2;
    const isSel  = this.selTokens.has(token);

    let cx: number, cy: number, tr: number;
    if (isHex) {
      const cn = this.hexCenter(token.col, token.row, r, pointy);
      cx = cn.x; cy = cn.y; tr = r * 0.82 * token.size;
    } else {
      cx = token.col * board.cellSize + board.cellSize * token.size / 2;
      cy = token.row * board.cellSize + board.cellSize * token.size / 2;
      tr = board.cellSize * token.size / 2 * 0.88;
    }

    const img = token.portrait ? this.loadImg(token.portrait) : null;

    // ── clipped portrait / fill ───────────────────────────────────────────
    ctx.save();
    ctx.globalAlpha = token.defeated ? 0.45 : 1;
    ctx.beginPath(); ctx.arc(cx, cy, tr, 0, Math.PI * 2); ctx.clip();
    if (img) {
      ctx.drawImage(img, cx - tr, cy - tr, tr * 2, tr * 2);
    } else {
      const g = ctx.createRadialGradient(cx - tr * 0.25, cy - tr * 0.25, 0, cx, cy, tr);
      g.addColorStop(0, token.color + "ff"); g.addColorStop(1, token.color + "99");
      ctx.fillStyle = g;
      ctx.fillRect(cx - tr, cy - tr, tr * 2, tr * 2);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = `bold ${tr * 0.55}px 'Courier New'`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(token.name.slice(0, 2).toUpperCase(), cx, cy);
    }
    ctx.restore();

    // ── defeated X overlay ────────────────────────────────────────────────
    if (token.defeated) {
      ctx.save();
      ctx.strokeStyle = "#e74c3c";
      ctx.lineWidth   = 3 / this.zoom;
      ctx.globalAlpha = 0.9;
      const d = tr * 0.5;
      ctx.beginPath(); ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d); ctx.stroke();
      ctx.restore();
    }

    // ── border / selection glow ───────────────────────────────────────────
    ctx.save();
    if (isSel) { ctx.shadowColor = token.color; ctx.shadowBlur = 12 / this.zoom; }
    ctx.beginPath(); ctx.arc(cx, cy, tr, 0, Math.PI * 2);
    ctx.strokeStyle = token.defeated ? "#555555" : isSel ? "#ffffff" : token.color;
    ctx.lineWidth   = (isSel ? 2.5 : 1.5) / this.zoom;
    ctx.stroke();
    ctx.restore();

    // ── name label ────────────────────────────────────────────────────────
    const fs = Math.max(8, board.cellSize * 0.17);
    ctx.save();
    ctx.globalAlpha = token.defeated ? 0.55 : 1;
    ctx.font = `${fs}px 'Courier New'`;
    const tw = ctx.measureText(token.name).width;
    const lx = cx - tw / 2 - 3, ly = cy + tr + 2 / this.zoom;
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(lx, ly, tw + 6, fs + 4);
    ctx.fillStyle = token.defeated ? "#888" : "#e0e8ff";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(token.name, cx, ly + 2);
    ctx.restore();

    // ── HP bar ────────────────────────────────────────────────────────────
    if (token.maxHp !== undefined && token.maxHp > 0) {
      const bw  = tr * 2, bh = Math.max(3, board.cellSize * 0.06);
      const bx  = cx - tr, by = cy + tr + fs + 6 / this.zoom;
      const pct = Math.max(0, Math.min(1, (token.hp ?? token.maxHp) / token.maxHp));
      ctx.save();
      ctx.globalAlpha = token.defeated ? 0.4 : 1;
      ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = pct > 0.5 ? "#2ecc71" : pct > 0.25 ? "#f39c12" : "#e74c3c";
      ctx.fillRect(bx, by, bw * pct, bh);
      ctx.restore();
    }

    // ── condition pips ────────────────────────────────────────────────────
    if (token.conditions.length > 0) {
      const pip = Math.max(8, board.cellSize * 0.17), gap = pip * 0.25;
      ctx.save();
      token.conditions.slice(0, 5).forEach((cond, i) => {
        const px = cx - tr + i * (pip + gap), py = cy - tr - pip - 2 / this.zoom;
        ctx.fillStyle = "#7c3aed"; ctx.fillRect(px, py, pip, pip);
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${pip * 0.65}px sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(cond[0].toUpperCase(), px + pip / 2, py + pip / 2);
      });
      ctx.restore();
    }
  }

  // ── Image loading ─────────────────────────────────────────────────────────

  /**
   * Resolve a stored path (vault-relative like "maps/dungeon.png") to a
   * live resource URL. Also handles old saves that stored app:// URLs.
   */
  resolveImageUrl(path: string): string | null {
    if (!path) return null;
    // Already an external URL
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    // Vault-relative path — look up the file and get a fresh resource URL
    const byPath = this.app.vault.getAbstractFileByPath(path) as TFile | null;
    if (byPath) return this.app.vault.getResourcePath(byPath);
    // Try short name resolution
    const resolved = this.app.metadataCache.getFirstLinkpathDest(path, "");
    if (resolved) return this.app.vault.getResourcePath(resolved);
    // Old save with app:// URL — return as-is and hope for the best
    if (path.startsWith("app://")) return path;
    return null;
  }

  loadImg(src: string): HTMLImageElement | null {
    // Resolve vault path to a current resource URL on every call
    const url = this.resolveImageUrl(src) ?? src;
    if (this.imgCache.has(url)) return this.imgCache.get(url)!;
    if (this.imgLoading.has(url)) return null;
    this.imgLoading.add(url);
    const img = new Image();
    img.onload  = () => { this.imgCache.set(url, img); this.imgLoading.delete(url); this.dirty = true; };
    img.onerror = () => { this.imgLoading.delete(url); console.warn("VTT: cannot load", src); };
    img.src = url;
    return null;
  }

  // ── Coordinates ───────────────────────────────────────────────────────────

  screenToWorld(sx: number, sy: number) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (sx - rect.left - this.panX) / this.zoom,
      y: (sy - rect.top  - this.panY) / this.zoom,
    };
  }

  worldToCell(wx: number, wy: number) {
    const { board } = this;
    if (board.gridType === "square") {
      return { col: Math.floor(wx / board.cellSize), row: Math.floor(wy / board.cellSize) };
    }
    const pointy = board.gridType === "hex-pointy";
    const r = board.cellSize / 2;
    let best = { col: 0, row: 0 }, bestD = Infinity;
    for (let row = 0; row < board.rows; row++) {
      for (let col = 0; col < board.cols; col++) {
        const c = this.hexCenter(col, row, r, pointy);
        const d = Math.hypot(wx - c.x, wy - c.y);
        if (d < bestD) { bestD = d; best = { col, row }; }
      }
    }
    return best;
  }

  tokenAt(wx: number, wy: number): Token | null {
    const { board } = this;
    const isHex  = board.gridType !== "square";
    const pointy = board.gridType === "hex-pointy";
    const r      = board.cellSize / 2;
    for (let i = this.S.tokens.length - 1; i >= 0; i--) {
      const t = this.S.tokens[i];
      let cx: number, cy: number, tr: number;
      if (isHex) {
        const c = this.hexCenter(t.col, t.row, r, pointy);
        cx = c.x; cy = c.y; tr = r * 0.82 * t.size;
      } else {
        cx = t.col * board.cellSize + board.cellSize * t.size / 2;
        cy = t.row * board.cellSize + board.cellSize * t.size / 2;
        tr = board.cellSize * t.size / 2 * 0.88;
      }
      if (Math.hypot(wx - cx, wy - cy) <= tr) return t;
    }
    return null;
  }

  // ── Events ────────────────────────────────────────────────────────────────

  attachEvents() {
    const c = this.canvas;
    c.addEventListener("mousedown",   e => this.onDown(e.clientX, e.clientY, e.button));
    c.addEventListener("mousemove",   e => this.onMove(e.clientX, e.clientY));
    c.addEventListener("mouseup",     () => this.onUp());
    c.addEventListener("mouseleave",  () => this.onUp());
    c.addEventListener("wheel",       e => { e.preventDefault(); this.onWheel(e); }, { passive: false });
    c.addEventListener("contextmenu", e => { e.preventDefault(); this.onRightClick(e.clientX, e.clientY); });
    c.addEventListener("dblclick",    e => this.onDblClick(e.clientX, e.clientY));
    c.addEventListener("touchstart",  e => { e.preventDefault(); const t = e.touches[0]; this.onDown(t.clientX, t.clientY, 0); }, { passive: false });
    c.addEventListener("touchmove",   e => { e.preventDefault(); const t = e.touches[0]; this.onMove(t.clientX, t.clientY); }, { passive: false });
    c.addEventListener("touchend",    () => this.onUp());

    // Arrow key navigation for the selected token.
    // Listen on the container so it works whenever the view is focused.
    // Tab/Escape also handled: Tab cycles selection, Escape deselects.
    this.containerEl.setAttribute("tabindex", "0");
    this.containerEl.addEventListener("keydown", e => this.onKey(e));
  }

  onKey(e: KeyboardEvent) {
    // Don't steal keys from input fields (e.g. token editor modal)
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    const ARROW = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    if (ARROW.includes(e.key)) {
      if (this.selTokens.size === 0) return;
      e.preventDefault();

      const { board } = this;
      const isHex  = board.gridType !== "square";
      const pointy = board.gridType === "hex-pointy";
      for (const t of this.selTokens) {
        if (isHex) {
          const { dc, dr } = this.hexArrowDelta(e.key, t.col, t.row, pointy);
          t.col = Math.max(0, Math.min(board.cols - t.size, t.col + dc));
          t.row = Math.max(0, Math.min(board.rows - t.size, t.row + dr));
        } else {
          const step = 1;
          if (e.key === "ArrowUp")    t.row = Math.max(0,                   t.row - step);
          if (e.key === "ArrowDown")  t.row = Math.min(board.rows - t.size, t.row + step);
          if (e.key === "ArrowLeft")  t.col = Math.max(0,                   t.col - step);
          if (e.key === "ArrowRight") t.col = Math.min(board.cols - t.size, t.col + step);
        }
      }

      this.plugin.saveVTTSettings();
      this.dirty = true;
      return;
    }

    // Tab: cycle selection through tokens on the board
    if (e.key === "Tab") {
      e.preventDefault();
      const tokens = this.S.tokens;
      if (tokens.length === 0) return;
      const first = this.selTokens.size === 1 ? [...this.selTokens][0] : null;
      const idx = first ? tokens.indexOf(first) : -1;
      const next = e.shiftKey
        ? (idx - 1 + tokens.length) % tokens.length
        : (idx + 1) % tokens.length;
      this.selTokens.clear();
      this.selTokens.add(tokens[next]);
      this.dirty = true;
      return;
    }

    // Escape: deselect
    if (e.key === "Escape") {
      this.selTokens.clear();
      this.dirty = true;
    }
  }

  /**
   * Returns the col/row delta for one arrow-key step on a hex grid.
   * Hex grids use offset coordinates (odd-row or odd-col shift), so the
   * correct neighbor depends on which row/col the token is currently on.
   */
  hexArrowDelta(key: string, col: number, row: number, pointy: boolean): { dc: number; dr: number } {
    if (pointy) {
      // Pointy-top: rows are staggered. Odd rows are shifted right by half a cell.
      // Up/Down move vertically; Left/Right move diagonally.
      const oddRow = row % 2 === 1;
      if (key === "ArrowUp")    return oddRow ? { dc:  1, dr: -1 } : { dc:  0, dr: -1 };
      if (key === "ArrowDown")  return oddRow ? { dc:  1, dr:  1 } : { dc:  0, dr:  1 };
      if (key === "ArrowLeft")  return { dc: -1, dr:  0 };
      if (key === "ArrowRight") return { dc:  1, dr:  0 };
    } else {
      // Flat-top: columns are staggered. Odd columns are shifted down.
      const oddCol = col % 2 === 1;
      if (key === "ArrowLeft")  return oddCol ? { dc: -1, dr:  1 } : { dc: -1, dr:  0 };
      if (key === "ArrowRight") return oddCol ? { dc:  1, dr:  1 } : { dc:  1, dr:  0 };
      if (key === "ArrowUp")    return { dc:  0, dr: -1 };
      if (key === "ArrowDown")  return { dc:  0, dr:  1 };
    }
    return { dc: 0, dr: 0 };
  }

  onDown(sx: number, sy: number, button: number) {
    this.closeCtxMenu();
    const w = this.screenToWorld(sx, sy);

    // ── Align-BG mode: left-click always moves the image ─────────────────
    if (this.mode === "align-bg" && button === 0) {
      this.isPanning  = true;
      // store anchor as screen - board.bgX*zoom - panX (in screen space)
      this.panAnchorX  = sx - this.board.bgX * this.zoom - this.panX;
      this.panAnchorY  = sy - this.board.bgY * this.zoom - this.panY;
      this.bgPanStartX = this.board.bgX;
      this.bgPanStartY = this.board.bgY;
      return;
    }

    // ── Normal mode ───────────────────────────────────────────────────────
    const token = this.tokenAt(w.x, w.y);

    // Measurement mode: left click starts/updates measure line
    if (this.measuring && button === 0) {
      this.measureStart = { x: w.x, y: w.y };
      this.measureEnd   = { x: w.x, y: w.y };
      this.dirty = true;
      return;
    }

    if (button === 1 || (button === 0 && !token)) {
      // Clear selection when clicking empty space (not shift-clicking)
      if (button === 0 && !token && !(window as any).lastShiftState) {
        this.selTokens.clear();
        this.dirty = true;
      }
      this.isPanning  = true;
      this.panAnchorX = sx - this.panX;
      this.panAnchorY = sy - this.panY;
      this.canvas.style.cursor = "grabbing";
      return;
    }

    if (button === 0 && token) {
      const { board } = this;
      const isHex  = board.gridType !== "square";
      const pointy = board.gridType === "hex-pointy";
      const r      = board.cellSize / 2;

      // Shift-click toggles token in/out of selection without starting a drag
      const shiftHeld = !!(window as any).lastShiftState;
      if (shiftHeld) {
        if (this.selTokens.has(token)) this.selTokens.delete(token);
        else this.selTokens.add(token);
        this.dirty = true;
        return;
      }

      // Plain click: if token not already in selection, replace selection
      if (!this.selTokens.has(token)) {
        this.selTokens.clear();
        this.selTokens.add(token);
      }

      // Record drag offsets for every selected token
      this.dragToken = token;
      this.dragOffsets.clear();
      for (const t of this.selTokens) {
        let tcx: number, tcy: number;
        if (isHex) {
          const cn = this.hexCenter(t.col, t.row, r, pointy);
          tcx = cn.x; tcy = cn.y;
        } else {
          tcx = t.col * board.cellSize + board.cellSize * t.size / 2;
          tcy = t.row * board.cellSize + board.cellSize * t.size / 2;
        }
        this.dragOffsets.set(t.id, { x: w.x - tcx, y: w.y - tcy });
      }
      this.dragOffX = this.dragOffsets.get(token.id)!.x;
      this.dragOffY = this.dragOffsets.get(token.id)!.y;
      this.dirty = true;
    }
  }

  onMove(sx: number, sy: number) {
    if (this.measuring && this.measureStart) {
      const w = this.screenToWorld(sx, sy);
      this.measureEnd = { x: w.x, y: w.y };
      this.dirty = true;
      return;
    }
    if (!this.isPanning && !this.dragToken) return;

    if (this.mode === "align-bg" && this.isPanning) {
      // move background image in world space
      this.board.bgX = (sx - this.panAnchorX - this.panX) / this.zoom;
      this.board.bgY = (sy - this.panAnchorY - this.panY) / this.zoom;
      this.dirty = true;
      return;
    }

    if (this.isPanning) {
      this.panX  = sx - this.panAnchorX;
      this.panY  = sy - this.panAnchorY;
      this.dirty = true;
      return;
    }

    if (this.dragToken) {
      const w   = this.screenToWorld(sx, sy);
      const { board } = this;
      // Move every selected token by computing their individual target cells
      for (const t of this.selTokens) {
        const off = this.dragOffsets.get(t.id) ?? { x: this.dragOffX, y: this.dragOffY };
        const wx  = w.x - off.x;
        const wy  = w.y - off.y;
        const { col, row } = this.worldToCell(wx, wy);
        const maxC = Math.max(0, board.cols - t.size);
        const maxR = Math.max(0, board.rows - t.size);
        t.col = Math.max(0, Math.min(maxC, col));
        t.row = Math.max(0, Math.min(maxR, row));
      }
      this.dirty = true;
    }
  }

  onUp() {
    if (this.isPanning) {
      this.isPanning = false;
      if (this.mode === "align-bg") {
        // save bg position after drag
        this.plugin.saveVTTSettings();
      } else {
        this.canvas.style.cursor = "default";
      }
    }
    if (this.dragToken) {
      this.plugin.saveVTTSettings();
      this.dragToken = null;
    }
  }

  onWheel(e: WheelEvent) {
    if (this.mode === "align-bg") {
      // scroll scales the background image, not the viewport
      // Shift = fine control (10x slower)
      const step   = e.shiftKey ? 0.001 : 0.01;
      const delta  = e.deltaY < 0 ? step : -step;
      // scale toward the world point under the cursor so the image
      // appears to zoom around that point
      const w      = this.screenToWorld(e.clientX, e.clientY);
      const oldScale  = this.board.bgScale;
      const newScale  = Math.max(0.01, oldScale + delta * oldScale);
      const scaleFactor = newScale / oldScale;
      // adjust offset so the world point under the cursor stays fixed
      this.board.bgX = w.x - (w.x - this.board.bgX) * scaleFactor;
      this.board.bgY = w.y - (w.y - this.board.bgY) * scaleFactor;
      this.board.bgScale = newScale;
      this.plugin.saveVTTSettings();
      this.dirty = true;
      return;
    }

    // Normal mode: zoom the viewport
    const factor  = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(0.1, Math.min(6, this.zoom * factor));
    const rect    = this.canvas.getBoundingClientRect();
    const mx      = e.clientX - rect.left;
    const my      = e.clientY - rect.top;
    this.panX  = mx - (mx - this.panX) * (newZoom / this.zoom);
    this.panY  = my - (my - this.panY) * (newZoom / this.zoom);
    this.zoom  = newZoom;
    this.dirty = true;
  }

  onRightClick(sx: number, sy: number) {
    if (this.mode === "align-bg") return; // no ctx menu in align mode
    const w = this.screenToWorld(sx, sy);
    const token = this.tokenAt(w.x, w.y);
    if (token) this.openCtxMenu(token, sx, sy);
  }

  onDblClick(sx: number, sy: number) {
    if (this.mode === "align-bg") { this.setMode("normal"); return; }
    const w = this.screenToWorld(sx, sy);
    const token = this.tokenAt(w.x, w.y);
    if (!token) return;
    // Check if click is near the HP bar — open quick HP edit, else full editor
    const { board } = this;
    const isHex  = board.gridType !== "square";
    const pointy = board.gridType === "hex-pointy";
    const r      = board.cellSize / 2;
    let cy: number, tr: number;
    if (isHex) {
      const cn = this.hexCenter(token.col, token.row, r, pointy);
      cy = cn.y; tr = r * 0.82 * token.size;
    } else {
      cy = token.row * board.cellSize + board.cellSize * token.size / 2;
      tr = board.cellSize * token.size / 2 * 0.88;
    }
    const fs   = Math.max(8, board.cellSize * 0.17);
    const barY = (cy + tr + fs + 6 / this.zoom) * this.zoom + this.panY;
    const inHpBar = token.maxHp !== undefined && Math.abs(sy - (this.canvas.getBoundingClientRect().top + barY)) < 16;
    if (inHpBar) {
      this.openHpEdit(token, sx - this.canvas.getBoundingClientRect().left, sy - this.canvas.getBoundingClientRect().top);
    } else {
      this.openTokenEditor(token);
    }
  }

  // ── Context menu ──────────────────────────────────────────────────────────

  openCtxMenu(token: Token, sx: number, sy: number) {
    this.closeCtxMenu();
    const menu = document.createElement("div");
    menu.style.cssText =
      `position:fixed;top:${sy}px;left:${sx}px;z-index:9999;` +
      `background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:var(--radius-m);` +
      `padding:var(--size-2-1);min-width:170px;box-shadow:var(--shadow-l);`;
    const row = (label: string, fn: () => void) => {
      const el = document.createElement("div");
      el.textContent = label;
      el.style.cssText =
        "padding:6px 10px;cursor:pointer;color:var(--text-normal);font-size:var(--font-ui-small);border-radius:var(--radius-s);user-select:none;";
      el.onmouseenter = () => { el.style.background = "var(--background-modifier-hover)"; };
      el.onmouseleave = () => { el.style.background = ""; };
      el.onclick = () => { this.closeCtxMenu(); fn(); };
      menu.appendChild(el);
    };
    row("Open note",         () => {
      const f = this.app.vault.getAbstractFileByPath(token.filePath) as TFile | null;
      if (f) this.app.workspace.getLeaf(false).openFile(f);
    });
    row("Edit token",        () => this.openTokenEditor(token));
    row("Refresh from note", () => this.refreshToken(token));
    row(token.defeated ? "Restore token" : "Defeat token", () => {
      token.defeated = !token.defeated;
      this.plugin.saveVTTSettings(); this.dirty = true;
    });
    row("Remove",              () => {
      this.S.tokens = this.S.tokens.filter(t => t.id !== token.id);
      this.selTokens.delete(token);
      this.plugin.saveVTTSettings(); this.dirty = true;
    });
    document.body.appendChild(menu);
    this.ctxMenu = menu;
    const dismiss = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        this.closeCtxMenu();
        document.removeEventListener("mousedown", dismiss, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", dismiss, true), 0);
  }

  closeCtxMenu() { this.ctxMenu?.remove(); this.ctxMenu = null; }

  // ── Token management ──────────────────────────────────────────────────────

  openAddToken() {
    new NoteSuggestModal(this.app, async file => {
      const token = await this.tokenFromFile(file);
      this.S.tokens.push(token);
      this.plugin.saveVTTSettings();
      this.dirty = true;
      new Notice(`Added ${token.name} to board`);
    }).open();
  }

  resolvePortrait(fm: Record<string, unknown>, sourceFile: TFile): string | null {
    const raw = fm.portrait;
    if (!raw) return null;
    // Obsidian may parse [[file.png]] into an object with a path field
    if (typeof raw === "object" && raw !== null && "path" in raw) {
      const f = this.app.vault.getAbstractFileByPath((raw as {path:string}).path) as TFile | null;
      return f ? this.app.vault.getResourcePath(f) : null;
    }
    let linktext = String(raw).trim();
    // Strip [[ ]] wrapper present when typed as raw text
    if (linktext.startsWith("[[") && linktext.endsWith("]]")) {
      linktext = linktext.slice(2, -2);
    }
    // Strip alias after |
    const pipe = linktext.indexOf("|");
    if (pipe !== -1) linktext = linktext.slice(0, pipe).trim();
    if (!linktext) return null;
    // Resolve via metadata cache so short names work
    const resolved = this.app.metadataCache.getFirstLinkpathDest(linktext, sourceFile.path);
    if (resolved) return this.app.vault.getResourcePath(resolved);
    // Fall back to exact path
    const byPath = this.app.vault.getAbstractFileByPath(linktext) as TFile | null;
    if (byPath) return this.app.vault.getResourcePath(byPath);
    // Last resort: treat as external URL
    return linktext;
  }

  async tokenFromFile(file: TFile): Promise<Token> {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const portrait = this.resolvePortrait(fm, file);
    const hp    = fm.hp    !== undefined ? Number(fm.hp)    : undefined;
    const maxHp = fm.maxHp !== undefined ? Number(fm.maxHp)
                : fm["max-hp"] !== undefined ? Number(fm["max-hp"]) : hp;
    return {
      id:         `tok_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      filePath:   file.path,
      name:       String(fm.name ?? file.basename),
      portrait,
      col: 0, row: 0,
      size:       Math.max(1, Number(fm.size) || 1),
      type:       fm.type === "monster" ? "monster" : fm.type === "character" ? "character" : "unknown",
      color:      String(fm.color ?? nextColor()),
      hp, maxHp,
      conditions: Array.isArray(fm.conditions) ? fm.conditions.map(String) : [],
    };
  }

  async refreshToken(token: Token) {
    const file = this.app.vault.getAbstractFileByPath(token.filePath) as TFile | null;
    if (!file) { new Notice("Note not found."); return; }
    const fresh = await this.tokenFromFile(file);
    Object.assign(token, fresh, { id: token.id, col: token.col, row: token.row });
    this.plugin.saveVTTSettings(); this.dirty = true;
    new Notice(`Refreshed ${token.name}`);
  }

  openTokenEditor(token: Token) {
    new TokenDetailModal(this.app, token, () => {
      this.plugin.saveVTTSettings(); this.dirty = true;
    }).open();
  }

  // ── Measurement ───────────────────────────────────────────────────────────

  drawMeasurement(start: {x:number,y:number}, end: {x:number,y:number}) {
    const { ctx, board } = this;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const cells = dist / board.cellSize;

    ctx.save();
    ctx.strokeStyle = "rgba(255,200,50,0.9)";
    ctx.lineWidth   = 2 / this.zoom;
    ctx.setLineDash([6 / this.zoom, 4 / this.zoom]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // endpoint dots
    [start, end].forEach(pt => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5 / this.zoom, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,200,50,0.9)";
      ctx.fill();
    });

    // distance label
    const label = `${cells.toFixed(1)} cells`;
    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2 - 10 / this.zoom;
    const fs  = Math.max(10, 13 / this.zoom);
    ctx.font = `bold ${fs}px 'Courier New'`;
    const tw  = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(mx - tw/2 - 4, my - fs, tw + 8, fs + 6);
    ctx.fillStyle = "rgba(255,220,80,1)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, mx, my - fs/2 + 3);
    ctx.restore();
  }

  // ── Auto-spread tokens on load ────────────────────────────────────────────
  // Places tokens in a spiral pattern from center so they don't all pile on (0,0)

  spreadTokens() {
    const { board, tokens } = this.S;
    if (tokens.length === 0) return;

    const cx = Math.floor(board.cols / 2);
    const cy = Math.floor(board.rows / 2);
    const occupied = new Set<string>();
    const key = (c: number, r: number) => `${c},${r}`;

    // Spiral out from center, find an unoccupied cell for each token
    const placed: { token: Token; col: number; row: number }[] = [];

    for (const token of tokens) {
      let found = false;
      for (let radius = 0; radius < Math.max(board.cols, board.rows); radius++) {
        // Walk the perimeter of a square at this radius
        const positions: [number, number][] = [];
        for (let d = -radius; d <= radius; d++) {
          positions.push([cx + d, cy - radius]);
          positions.push([cx + d, cy + radius]);
          positions.push([cx - radius, cy + d]);
          positions.push([cx + radius, cy + d]);
        }
        for (const [tc, tr] of positions) {
          if (tc < 0 || tr < 0 || tc + token.size > board.cols || tr + token.size > board.rows) continue;
          // Check all cells this token would occupy
          let clear = true;
          for (let dc = 0; dc < token.size && clear; dc++) {
            for (let dr = 0; dr < token.size && clear; dr++) {
              if (occupied.has(key(tc + dc, tr + dr))) clear = false;
            }
          }
          if (clear) {
            placed.push({ token, col: tc, row: tr });
            for (let dc = 0; dc < token.size; dc++) {
              for (let dr = 0; dr < token.size; dr++) {
                occupied.add(key(tc + dc, tr + dr));
              }
            }
            found = true; break;
          }
        }
        if (found) break;
      }
    }

    for (const { token, col, row } of placed) {
      token.col = col;
      token.row = row;
    }
  }

  // ── IT sync: update token HP + conditions from tracker store ─────────────
  // Called on every tracker subscribe event alongside follow-initiative

  syncFromTracker(combatants: any[]) {
    if (!combatants || !Array.isArray(combatants)) return;
    let changed = false;
    for (const c of combatants) {
      const name = String(c.display ?? c.name ?? "");
      // Find matching token(s) by name
      const matches = this.S.tokens.filter(t => {
        const tn = t.name.toLowerCase();
        const cn = name.toLowerCase();
        return tn === cn || tn.startsWith(cn + " ") || cn.startsWith(tn + " ");
      });
      for (const token of matches) {
        // HP sync
        const newHp = c.currentHP ?? c.hp;
        if (newHp !== undefined && token.hp !== newHp) {
          token.hp = newHp;
          // Mark defeated if HP hits 0
          const wasDefeated = token.defeated;
          token.defeated = newHp <= 0;
          if (token.defeated !== wasDefeated) changed = true;
          changed = true;
        }
        // Conditions sync — IT uses a Set or array of status objects
        const statuses: string[] = [];
        const rawStatus = c.status;
        if (Array.isArray(rawStatus)) {
          for (const s of rawStatus) {
            const name = s?.name ?? s?.id ?? (typeof s === "string" ? s : "");
            if (name) statuses.push(String(name));
          }
        } else if (rawStatus instanceof Set) {
          for (const s of rawStatus) {
            const name = (s as any)?.name ?? (s as any)?.id ?? String(s);
            if (name) statuses.push(name);
          }
        }
        const existing = JSON.stringify(token.conditions.sort());
        const incoming = JSON.stringify(statuses.sort());
        if (existing !== incoming) {
          token.conditions = statuses;
          changed = true;
        }
      }
    }
    if (changed) {
      this.plugin.saveVTTSettings();
      this.dirty = true;
    }
  }

  // ── Quick HP edit ─────────────────────────────────────────────────────────

  openHpEdit(token: Token, sx: number, sy: number) {
    this.closeHpEdit();
    const wrap = this.wrap.createDiv();
    wrap.style.cssText = `
      position:absolute;z-index:100;
      top:${sy - 20}px;left:${sx - 40}px;
      background:var(--background-primary);
      border:1px solid var(--interactive-accent);
      border-radius:var(--radius-m);padding:6px 8px;
      display:flex;align-items:center;gap:6px;
      box-shadow:var(--shadow-l);
    `;
    const lbl = wrap.createSpan({ text: token.name });
    lbl.style.cssText = "font-size:var(--font-ui-smaller);color:var(--text-muted);white-space:nowrap;";

    const input = wrap.createEl("input");
    input.type = "number";
    input.value = String(token.hp ?? 0);
    input.style.cssText = `
      width:60px;background:var(--background-modifier-form-field);
      border:1px solid var(--background-modifier-border);
      border-radius:var(--radius-s);color:var(--text-normal);
      padding:2px 6px;font-size:var(--font-ui-small);text-align:center;
    `;

    const maxLbl = wrap.createSpan({ text: `/ ${token.maxHp ?? "?"}` });
    maxLbl.style.cssText = "font-size:var(--font-ui-smaller);color:var(--text-muted);";

    const apply = () => {
      const v = parseInt(input.value);
      if (!isNaN(v)) {
        token.hp = Math.max(0, v);
        token.defeated = token.hp <= 0;
        this.plugin.saveVTTSettings();
        this.dirty = true;
      }
      this.closeHpEdit();
    };
    input.onkeydown = e => { if (e.key === "Enter") apply(); if (e.key === "Escape") this.closeHpEdit(); };
    setTimeout(() => { input.focus(); input.select(); }, 10);

    const okBtn = wrap.createEl("button", { text: "✓" });
    okBtn.style.cssText = "background:var(--interactive-accent);border:none;border-radius:var(--radius-s);color:#fff;padding:2px 7px;cursor:pointer;";
    okBtn.onclick = apply;

    this.hpEditToken = token;
    this.hpEditEl    = wrap;

    // Dismiss on outside click
    const dismiss = (e: MouseEvent) => {
      if (!wrap.contains(e.target as Node)) {
        this.closeHpEdit();
        document.removeEventListener("mousedown", dismiss, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", dismiss, true), 0);
  }

  closeHpEdit() {
    this.hpEditEl?.remove();
    this.hpEditEl    = null;
    this.hpEditToken = null;
  }

  rebuildBoardSel() {
    if (!this.boardBtn) return;
    const spans = this.boardBtn.querySelectorAll("span");
    // second span is the label (first is the icon)
    if (spans[1]) spans[1].textContent = this.S.name;
  }

  /** Request a re-render on the next animation frame. */
  markDirty() {
    this.dirty = true;
  }

  resetViewport() {
    this.panX = 0; this.panY = 0; this.zoom = 1;
  }

  pickBackground() {
    new ImageSuggestModal(this.app, file => {
      // Store vault-relative path — resource URLs are session-specific and change on restart
      this.board.backgroundImage = file.path;
      this.board.bgX     = 0;
      this.board.bgY     = 0;
      this.board.bgScale = 1;
      this.imgCache.clear(); // evict all cached images
      this.imgLoading.clear();
      this.fitGridToImage(file.path).then(() => {
        this.plugin.saveVTTSettings();
        this.dirty = true;
      });
      new Notice(`Background: ${file.basename} — use "Align BG" to position it`);
    }).open();
  }

  /**
   * Once the image at `url` is loaded, update cols/rows so the grid covers
   * the full image exactly at the current cellSize.
   * Uses the cache if already loaded, otherwise loads fresh.
   */
  fitGridToImage(path: string): Promise<void> {
    return new Promise(resolve => {
      const apply = (img: HTMLImageElement) => {
        const { cellSize } = this.board;
        this.board.cols = Math.max(1, Math.round(img.naturalWidth  / cellSize));
        this.board.rows = Math.max(1, Math.round(img.naturalHeight / cellSize));
        this.dirty = true;
        resolve();
      };

      // Resolve vault path to a live resource URL
      const url = this.resolveImageUrl(path) ?? path;

      if (this.imgCache.has(url)) { apply(this.imgCache.get(url)!); return; }

      const img = new Image();
      img.onload  = () => { this.imgCache.set(url, img); this.imgLoading.delete(url); apply(img); };
      img.onerror = () => { this.imgLoading.delete(url); console.warn("VTT: fitGridToImage failed:", url); resolve(); };
      img.src = url;
    });
  }

  // ── Follow-initiative tracking ───────────────────────────────────────────

  toggleFollow() {
    if (this.followActive) {
      this.stopFollow();
    } else {
      this.startFollow();
    }
  }

  startFollow() {
    const it = (this.app as any).plugins?.plugins?.["initiative-tracker"];
    if (!it?.tracker?.subscribe) {
      new Notice("Initiative Tracker plugin not found or not active.");
      return;
    }

    this.followActive   = true;
    this.lastFollowId   = "";

    if (this.followBtnEl) {
      this.followBtnEl.style.color      = "var(--interactive-accent)";
      this.followBtnEl.style.background = "var(--background-modifier-hover)";
    }

    // Subscribe to the Svelte store.  Called immediately (may be undefined if
    // combat hasn't started yet) and on every subsequent state change.
    // We also try tracker.data as a synchronous snapshot in the same callback
    // since some versions only update .data and don't push to subscribers.
    const unsub: () => void = it.tracker.subscribe((storeValue: any) => {
      const arr: any[] | null = Array.isArray(storeValue) ? storeValue : null;
      if (!arr) return;

      // Always sync HP and conditions from tracker state
      this.syncFromTracker(arr);

      const active = arr.find((combatant: any) => combatant.active === true);
      if (!active?.id) return;

      if (active.id === this.lastFollowId) return;
      this.lastFollowId = active.id;

      const displayName = String(active.display ?? active.name);

      const sameName = arr.filter((combatant: any) =>
        (combatant.display ?? combatant.name) === displayName
      );
      const rank = sameName.findIndex((combatant: any) => combatant.id === active.id);

      this.focusTokenByNameAndRank(displayName, rank);
    });

    // Store unsub so stopFollow() can call it.
    // followInterval repurposed as a flag; actual cleanup stored separately.
    (this as any)._itUnsub = unsub;
    this.followInterval = 1; // truthy sentinel

    new Notice("Following Initiative Tracker — combat turn changes will pan the board");
  }

  stopFollow() {
    this.followActive = false;

    // Call the Svelte unsubscribe function
    if (typeof (this as any)._itUnsub === "function") {
      (this as any)._itUnsub();
      (this as any)._itUnsub = null;
    }
    if (this.followInterval !== null) {
      this.followInterval = null;
    }

    if (this.followBtnEl) {
      this.followBtnEl.style.color      = "var(--icon-color)";
      this.followBtnEl.style.background = "";
    }
  }

  /**
   * Extract the active combatant name from the initiative-tracker Svelte store state.
   *
   * The subscribe callback receives the store value directly as `s`.
   * From console inspection of v13.x: s is undefined until combat starts,
   * then becomes the tracker state object.  tracker.data is also available
   * as a synchronous snapshot on the plugin object itself.
   *
   * We probe every known shape so this survives version changes.
   */


  /**
   * Find the first token whose name matches (case-insensitive, partial match allowed)
   * and animate the viewport to centre on it.
   */
  /**
   * Focus a token by name. If multiple tokens share the same name (e.g. "Goblin 1",
   * "Goblin 2", "Goblin 3"), rank selects which one: rank 0 = first match, 1 = second, etc.
   * Falls back to the first match if rank is out of range.
   */
  focusTokenByNameAndRank(name: string, rank: number) {
    const lc = name.toLowerCase();

    // Match tokens whose name equals IT name OR starts with it (handles "Goblin" -> "Goblin 1", "Goblin 2")
    // Sorted by token array order so rank maps correctly.
    const matches = this.S.tokens.filter(t => {
      const tn = t.name.toLowerCase();
      return tn === lc || tn.startsWith(lc + " ") || lc.startsWith(tn + " ") || tn.startsWith(lc);
    });

    const token = matches[rank] ?? matches[0];
    if (!token) return;
    this.focusToken(token);
  }

  focusTokenByName(name: string) {
    this.focusTokenByNameAndRank(name, 0);
  }

  focusToken(token: Token) {
    // Select it
    this.selTokens.clear();
    this.selTokens.add(token);

    // Compute token world-centre
    const { board } = this;
    const isHex  = board.gridType !== "square";
    const pointy = board.gridType === "hex-pointy";
    const r      = board.cellSize / 2;
    let wx: number, wy: number;
    if (isHex) {
      const c = this.hexCenter(token.col, token.row, r, pointy);
      wx = c.x; wy = c.y;
    } else {
      wx = token.col * board.cellSize + board.cellSize * token.size / 2;
      wy = token.row * board.cellSize + board.cellSize * token.size / 2;
    }

    // Animate pan+zoom so token fills ~20% of the viewport
    const targetZoom = Math.min(3, Math.max(1, 128 / board.cellSize));
    const cx = this.canvas.width  / 2;
    const cy = this.canvas.height / 2;
    this.animateFocusTo(wx, wy, targetZoom, cx, cy);
  }

  /**
   * Smoothly animate the viewport to centre world point (wx,wy) at zoom level z.
   * Uses a short easing loop via requestAnimationFrame.
   */
  animateFocusTo(wx: number, wy: number, targetZoom: number, cx: number, cy: number) {
    const startPanX  = this.panX;
    const startPanY  = this.panY;
    const startZoom  = this.zoom;
    const targetPanX = cx - wx * targetZoom;
    const targetPanY = cy - wy * targetZoom;

    const DURATION = 400; // ms
    const start    = performance.now();

    const step = (now: number) => {
      const t   = Math.min(1, (now - start) / DURATION);
      // ease-out cubic
      const e   = 1 - Math.pow(1 - t, 3);
      this.zoom  = startZoom  + (targetZoom  - startZoom)  * e;
      this.panX  = startPanX  + (targetPanX  - startPanX)  * e;
      this.panY  = startPanY  + (targetPanY  - startPanY)  * e;
      this.dirty = true;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Called by the plugin after an encounter note has been loaded into settings. */
  onEncounterLoaded() {
    // Preload all portrait images so they appear immediately
    for (const token of this.S.tokens) {
      if (token.portrait) this.loadImg(token.portrait);
    }
    // Auto-spread tokens so they don't pile up at (0,0)
    this.spreadTokens();
    // Fit grid to background image, then reset viewport
    const bg = this.board.backgroundImage;
    const finish = () => {
      this.panX = 0; this.panY = 0; this.zoom = 1;
      this.selTokens.clear();
      this.dragToken = null;
      this.plugin.saveVTTSettings();
      this.dirty = true;
    };
    if (bg) {
      this.fitGridToImage(bg).then(finish);
    } else {
      finish();
    }
  }
}


// ─── Encounter Parser ─────────────────────────────────────────────────────────
//
// Reads a note that was built with the initiative-tracker plugin and returns
// a structured description of the encounter: map image, players, and creatures.
//
// Supported creature line forms (all from initiative-tracker README):
//   Simple:   "Goblin"  |  "Goblin, 7, 15, 2"  |  "3: Goblin, 7, 15, 2"
//   Alias:    "[[Goblin, Bob]]"  |  "2: [[Goblin, Bob]], 7, 15"
//   Object:   "creature: Goblin / name: Ted / hp: 12 / ac: 13"  (YAML mapping)

interface EncounterCreature {
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

interface ParsedEncounter {
  /** Resolved resource URL for the background map, or null */
  mapUrl:    string | null;
  /** Raw player names / note-paths from frontmatter */
  players:   string[];
  creatures: EncounterCreature[];
}

export class EncounterParser {
  constructor(private app: App) {}

  async parse(file: TFile): Promise<ParsedEncounter> {
    const content  = await this.app.vault.cachedRead(file);
    const fm       = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};

    const mapUrl   = this.resolveMapUrl(fm, file);
    const players  = this.extractPlayers(fm);
    const creatures = this.extractCreatures(content, file);

    return { mapUrl, players, creatures };
  }

  // ── Map ────────────────────────────────────────────────────────────────────

  private resolveMapUrl(fm: Record<string, unknown>, file: TFile): string | null {
    const raw = fm.map ?? fm.background ?? fm["battle-map"] ?? fm.battlemap;
    if (!raw) return null;

    // Parsed wikilink object
    if (typeof raw === "object" && raw !== null && "path" in raw) {
      const f = this.app.vault.getAbstractFileByPath((raw as {path:string}).path) as TFile | null;
      return f ? f.path : null; // store vault path
    }

    let text = String(raw).trim();
    if (text.startsWith("[[") && text.endsWith("]]")) text = text.slice(2, -2);
    const pipe = text.indexOf("|");
    if (pipe !== -1) text = text.slice(0, pipe).trim();
    if (!text) return null;

    // Return vault path so it survives across sessions
    const resolved = this.app.metadataCache.getFirstLinkpathDest(text, file.path);
    if (resolved) return resolved.path;
    const byPath = this.app.vault.getAbstractFileByPath(text) as TFile | null;
    if (byPath) return byPath.path;
    return text; // external URL — stored as-is
  }

  // ── Players ────────────────────────────────────────────────────────────────

  private extractPlayers(fm: Record<string, unknown>): string[] {
    const raw = fm.players;
    if (!raw || raw === false || raw === "none" || raw === "false") return [];
    if (raw === true || raw === "true") return []; // "all players" — let caller handle via settings
    if (Array.isArray(raw)) return raw.map(v => this.stripWikilink(String(v)));
    return [this.stripWikilink(String(raw))];
  }

  private stripWikilink(s: string): string {
    s = s.trim();
    if (s.startsWith("[[") && s.endsWith("]]")) s = s.slice(2, -2);
    const pipe = s.indexOf("|");
    if (pipe !== -1) s = s.slice(0, pipe).trim();
    return s;
  }

  // ── Creatures ─────────────────────────────────────────────────────────────

  private extractCreatures(content: string, file: TFile): EncounterCreature[] {
    // Find all ```encounter ... ``` blocks
    const blockRe = /```encounter([\s\S]*?)```/g;
    const all: EncounterCreature[] = [];
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(content)) !== null) {
      const parsed = this.parseEncounterBlock(m[1]);
      all.push(...parsed);
    }
    return all;
  }

  private parseEncounterBlock(yaml: string): EncounterCreature[] {
    // We do a lightweight hand-rolled parse rather than pulling in a YAML lib.
    // Strategy: find the "creatures:" key, then read each list item.
    const lines = yaml.split("\n");
    const creatures: EncounterCreature[] = [];

    let inCreatures = false;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed === "creatures:") {
        inCreatures = true;
        i++;
        continue;
      }

      // Any top-level key (no leading spaces, ends with :) ends the creatures block
      if (inCreatures && /^[a-zA-Z]/.test(line) && line.includes(":")) {
        inCreatures = false;
      }

      if (!inCreatures) { i++; continue; }

      // List item
      if (!trimmed.startsWith("-")) { i++; continue; }

      // Collect the full item (may be multi-line for YAML object form)
      const itemLines: string[] = [trimmed.slice(1).trim()];
      const baseIndent = line.length - line.trimStart().length;
      i++;
      while (i < lines.length) {
        const next = lines[i];
        const nextTrimmed = next.trim();
        if (!nextTrimmed || nextTrimmed.startsWith("-") && (next.length - next.trimStart().length) <= baseIndent) break;
        if (next.length - next.trimStart().length > baseIndent) {
          itemLines.push(nextTrimmed.startsWith("-") ? nextTrimmed.slice(1).trim() : nextTrimmed);
          i++;
        } else break;
      }

      const parsed = this.parseCreatureItem(itemLines);
      if (parsed) creatures.push(...parsed);
    }

    return creatures;
  }

  /**
   * Parse one creature list item into one or more EncounterCreature objects.
   * itemLines[0] is the first line after the leading "- ".
   * Subsequent lines are indented sub-items.
   */
  private parseCreatureItem(itemLines: string[]): EncounterCreature[] {
    const first = itemLines[0].trim();

    // ── YAML object form: "creature: Goblin" on first line ────────────────
    if (first.match(/^creature\s*:/)) {
      return [this.parseObjectForm(itemLines, 1)];
    }

    // ── count: object on subsequent lines ─────────────────────────────────
    // e.g. first = "5:" and rest are object key:value pairs
    const countOnlyMatch = first.match(/^(\d+)\s*:?\s*$/);
    if (countOnlyMatch && itemLines.length > 1) {
      const count = parseInt(countOnlyMatch[1]);
      const sub = itemLines.slice(1);
      // sub could be "[Hobgoblin, Jeff]" or "creature: Hobgoblin ..."
      if (sub[0]?.trim().startsWith("[")) {
        return this.parseBracketLine(sub[0].trim(), count);
      }
      const obj = this.parseObjectForm(sub, count);
      return [obj];
    }

    // ── "N: ..." prefix form ───────────────────────────────────────────────
    const countPrefixMatch = first.match(/^(\d+)\s*:\s*(.+)$/);
    if (countPrefixMatch) {
      const count = parseInt(countPrefixMatch[1]);
      const rest  = countPrefixMatch[2].trim();
      // Could be "[Hobgoblin, Bob], 12, 13" or "Goblin, 7, 15, 2"
      if (rest.startsWith("[")) return this.parseBracketLine(rest, count);
      return [this.parseSimpleLine(rest, count)];
    }

    // ── bracket alias: "[[Goblin, Bob]], 7, 15" ───────────────────────────
    if (first.startsWith("[")) {
      return this.parseBracketLine(first, 1);
    }

    // ── plain: "Goblin" or "Goblin, 7, 15, 2" ─────────────────────────────
    return [this.parseSimpleLine(first, 1)];
  }

  /** Parse "Goblin" or "Goblin, 7, 15, 2" — no count prefix */
  private parseSimpleLine(s: string, count: number): EncounterCreature {
    const parts = s.split(",").map(p => p.trim());
    const name  = parts[0];
    const hp    = parts[1] !== undefined ? parseInt(parts[1]) : null;
    const ac    = parts[2] !== undefined ? parseInt(parts[2]) : null;
    const mod   = parts[3] !== undefined ? parseInt(parts[3]) : null;
    return {
      creature: name, name,
      hp:  isNaN(hp as number)  ? null : (hp  as number),
      ac:  isNaN(ac as number)  ? null : (ac  as number),
      mod: isNaN(mod as number) ? null : (mod as number),
      count,
    };
  }

  /** Parse "[[Hobgoblin, Bob]]" or "[Hobgoblin, Bob], 12, 13" */
  private parseBracketLine(s: string, count: number): EncounterCreature[] {
    // Strip outer [[ ]] or [ ]
    let inner = s;
    const dbl = inner.match(/^\[\[(.+?)\]\]/);
    const sgl = inner.match(/^\[(.+?)\]/);
    const alias = dbl ? dbl[1] : sgl ? sgl[1] : null;
    const rest  = inner.replace(/^\[\[.+?\]\]|^\[.+?\]/, "").replace(/^\s*,\s*/, "");
    const restParts = rest.split(",").map(p => p.trim());

    if (!alias) return [this.parseSimpleLine(s, count)];

    const aliasParts = alias.split(",").map(p => p.trim());
    const creature   = aliasParts[0];
    const name       = aliasParts[1] ?? creature;
    const hp  = restParts[0] ? parseInt(restParts[0]) : null;
    const ac  = restParts[1] ? parseInt(restParts[1]) : null;
    const mod = restParts[2] ? parseInt(restParts[2]) : null;

    const results: EncounterCreature[] = [];
    for (let i = 0; i < count; i++) {
      results.push({
        creature, name: count > 1 ? `${name} ${i + 1}` : name,
        hp:  isNaN(hp as number)  ? null : (hp  as number),
        ac:  isNaN(ac as number)  ? null : (ac  as number),
        mod: isNaN(mod as number) ? null : (mod as number),
        count: 1,
      });
    }
    return results;
  }

  /** Parse object form: lines like "creature: Goblin", "name: Ted", "hp: 12" */
  private parseObjectForm(lines: string[], count: number): EncounterCreature {
    const obj: Record<string, string> = {};
    for (const line of lines) {
      const kv = line.match(/^([a-z]+)\s*:\s*(.*)$/i);
      if (kv) obj[kv[1].toLowerCase()] = kv[2].trim();
    }
    const creature = obj.creature ?? obj.name ?? "Unknown";
    const name     = obj.name ?? creature;
    const hp  = obj.hp  ? parseInt(obj.hp)  : null;
    const ac  = obj.ac  ? parseInt(obj.ac)  : null;
    const mod = obj.mod ? parseInt(obj.mod) : null;
    return {
      creature, name,
      hp:  isNaN(hp as number)  ? null : (hp  as number),
      ac:  isNaN(ac as number)  ? null : (ac  as number),
      mod: isNaN(mod as number) ? null : (mod as number),
      count,
    };
  }
}



// ─── Bestiary Search Modal ────────────────────────────────────────────────────
//
// Searches the fantasy-statblocks plugin bestiary.
// API: app.plugins.getPlugin("obsidian-5e-statblocks").bestiary
// The bestiary is a Map<string, Monster> where each Monster has:
//   name, hp, ac, cr, type, subtype, size, source, ...

interface BestiaryMonster {
  name:     string;
  hp?:      number;
  ac?:      number | { ac: number }[];
  cr?:      string | number;
  type?:    string;
  subtype?: string;
  size?:    string;
  source?:  string;
}

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

class BestiarySuggestModal extends FuzzySuggestModal<BestiaryMonster> {
  private monsters: BestiaryMonster[] = [];
  private loaded = false;

  constructor(app: App, private onChoose: (m: BestiaryMonster) => void) {
    super(app);
    this.setPlaceholder("Loading bestiary...");
    BestiarySuggestModal.loadBestiary(app).then(monsters => {
      this.monsters = monsters;
      this.loaded = true;
      this.setPlaceholder(
        monsters.length > 0
          ? `Search ${monsters.length} creatures...`
          : "Bestiary empty — is Fantasy Statblocks installed?"
      );
      // Trigger a re-render of the suggestion list
      (this as any).updateSuggestions?.();
    });
  }

  static async loadBestiary(app: App): Promise<BestiaryMonster[]> {
    try {
      const plugin = (app as any).plugins?.plugins?.["obsidian-5e-statblocks"];
      if (!plugin?.api) return [];
      const api = plugin.api;
      // v4.x: api.getBestiary() returns Promise<Map<string, Monster>>
      if (typeof api.getBestiary === "function") {
        const map: Map<string, BestiaryMonster> = await api.getBestiary();
        if (map instanceof Map) return Array.from(map.values());
      }
      // fallback: api.getBestiaryCreatures() may return array directly
      if (typeof api.getBestiaryCreatures === "function") {
        const result = await api.getBestiaryCreatures();
        if (Array.isArray(result)) return result;
        if (result instanceof Map) return Array.from(result.values());
      }
      return [];
    } catch {
      return [];
    }
  }

  getItems(): BestiaryMonster[] { return this.monsters; }

  getItemText(m: BestiaryMonster): string {
    // Searched string — include name, type, source so they all match
    const type   = m.type    ? ` · ${m.type}`   : "";
    const source = m.source  ? ` (${m.source})`  : "";
    return `${m.name}${type}${source}`;
  }

  renderSuggestion(item: { item: BestiaryMonster }, el: HTMLElement) {
    const m = item.item;
    el.style.cssText = "display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:4px 8px;";

    const left = el.createDiv();
    left.style.cssText = "display:flex;flex-direction:column;gap:1px;min-width:0;";

    const name = left.createDiv({ text: m.name });
    name.style.cssText = "font-size:var(--font-ui-small);color:var(--text-normal);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

    const meta: string[] = [];
    if (m.type)   meta.push(m.type + (m.subtype ? ` (${m.subtype})` : ""));
    if (m.source) meta.push(m.source);
    if (meta.length) {
      const sub = left.createDiv({ text: meta.join(" · ") });
      sub.style.cssText = "font-size:var(--font-ui-smaller);color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    }

    const right = el.createDiv();
    right.style.cssText = "display:flex;gap:6px;flex-shrink:0;align-items:center;";

    const badge = (label: string, val: string | number | null | undefined) => {
      if (val === null || val === undefined || val === "") return;
      const b = right.createDiv();
      b.style.cssText = "font-size:10px;color:var(--text-faint);white-space:nowrap;";
      b.textContent = `${label} ${val}`;
    };

    badge("CR",  m.cr);
    badge("HP",  m.hp);
    badge("AC",  resolveAC(m.ac));
  }

  onChooseItem(m: BestiaryMonster): void { this.onChoose(m); }
}

// ─── Encounter Builder Modal ──────────────────────────────────────────────────

interface BuilderCreature {
  creature: string;     // bestiary/note name
  displayName: string;  // shown on token
  hp: string;
  ac: string;
  count: number;
}

class EncounterBuilderModal extends Modal {
  private noteName   = "New Encounter";
  private saveFolder = "";
  private mapPath    = "";
  private players:  string[]          = [];
  private creatures: BuilderCreature[] = [];

  constructor(app: App, private plugin: VTTPlugin) {
    super(app);
  }

  onOpen() {
    this.modalEl.style.cssText = `
      width: 680px; max-width: 95vw; max-height: 90vh; overflow: hidden;
    `;
    this.contentEl.style.cssText = `
      padding: 0; height: 100%;
      color: var(--text-normal);
      overflow-y: auto; max-height: 85vh;
    `;
    this.render();
  }

  onClose() { this.contentEl.empty(); }

  render() {
    const el = this.contentEl;
    el.empty();

    // ── Header ──────────────────────────────────────────────────────────────
    const header = el.createDiv();
    header.style.cssText =
      "padding:16px 20px 12px;border-bottom:1px solid var(--background-modifier-border);" +
      "display:flex;align-items:center;gap:10px;";
    const iconEl = header.createDiv();
    iconEl.style.cssText = "display:flex;align-items:center;color:var(--text-accent);";
    setIcon(iconEl, "swords");
    const title = header.createEl("h2", { text: "Encounter Builder" });
    title.style.cssText = "margin:0;font-size:var(--font-ui-large);color:var(--text-normal);";

    const body = el.createDiv();
    body.style.cssText = "padding:16px 20px;display:flex;flex-direction:column;gap:16px;";

    // ── Note name + folder ───────────────────────────────────────────────────
    this.section(body, "Note", (s) => {
      const row = s.createDiv();
      row.style.cssText = "display: grid; grid-template-columns: 1fr 1fr; gap: 10px;";

      this.field(row, "File name", this.noteName, (v) => { this.noteName = v; }, "e.g. Goblin Ambush");
      this.field(row, "Folder (optional)", this.saveFolder, (v) => { this.saveFolder = v; }, "e.g. Sessions/Combat");
    });

    // ── Map ──────────────────────────────────────────────────────────────────
    this.section(body, "Map Image", (s) => {
      const row = s.createDiv();
      row.style.cssText = "display: flex; gap: 8px; align-items: center;";

      const input = this.styledInput(row, this.mapPath, "[[dungeon.jpg]] or leave empty");
      input.style.flex = "1";
      input.oninput = () => { this.mapPath = input.value; };

      const pick = this.actionBtn(row, "Browse");
      pick.onclick = () => {
        new ImageSuggestModal(this.app, (file) => {
          this.mapPath = `[[${file.name}]]`;
          input.value  = this.mapPath;
        }).open();
      };
    });

    // ── Players ──────────────────────────────────────────────────────────────
    this.section(body, "Players", (s) => {
      const list = s.createDiv();
      list.style.cssText = "display: flex; flex-direction: column; gap: 6px;";

      const renderPlayers = () => {
        list.empty();
        this.players.forEach((p, i) => {
          const row = list.createDiv();
          row.style.cssText = "display: flex; gap: 6px; align-items: center;";
          const inp = this.styledInput(row, p, "Player note name");
          inp.style.flex = "1";
          inp.oninput = () => { this.players[i] = inp.value; };
          const browse = this.actionBtn(row, "Browse");
          browse.onclick = () => {
            new NoteSuggestModal(this.app, (file) => {
              this.players[i] = `[[${file.basename}]]`;
              inp.value = this.players[i];
            }).open();
          };
          const del = this.deleteBtn(row);
          del.onclick = () => { this.players.splice(i, 1); renderPlayers(); };
        });

        const addRow = list.createDiv();
        addRow.style.cssText = "margin-top: 2px;";
        const addBtn = this.addBtn(addRow, "+ Add Player");
        addBtn.onclick = () => { this.players.push(""); renderPlayers(); };
      };

      renderPlayers();
    });

    // ── Creatures ────────────────────────────────────────────────────────────
    this.section(body, "Creatures", (s) => {
      // Column headers
      const headers = s.createDiv();
      headers.style.cssText =
        "display:grid;grid-template-columns:2fr 2fr 60px 60px 52px 32px;" +
        "gap:6px;padding:0 0 4px;" +
        "font-size:var(--font-ui-smaller);color:var(--text-faint);letter-spacing:0.08em;text-transform:uppercase;";
      ["Creature / Note", "Display Name", "HP", "AC", "Count", ""].forEach(h => {
        headers.createSpan({ text: h });
      });

      const list = s.createDiv();
      list.style.cssText = "display: flex; flex-direction: column; gap: 6px;";

      const renderCreatures = () => {
        list.empty();
        this.creatures.forEach((cr, i) => {
          const row = list.createDiv();
          row.style.cssText =
            "display:grid;grid-template-columns:2fr 2fr 60px 60px 52px 32px;" +
            "gap:6px;align-items:center;" +
            "background:var(--background-modifier-hover);border:1px solid var(--background-modifier-border);" +
            "border-radius:var(--radius-m);padding:8px;";

          // Creature name input + browse
          const creatureWrap = row.createDiv();
          creatureWrap.style.cssText = "display: flex; gap: 4px; align-items: center;";
          const creatureIn = this.styledInput(creatureWrap, cr.creature, "Goblin");
          creatureIn.style.flex = "1"; creatureIn.style.minWidth = "0";
          creatureIn.oninput = () => {
            cr.creature = creatureIn.value;
            if (!cr.displayName) displayIn.placeholder = creatureIn.value || "Display name";
          };
          // Browse button: use bestiary if available, fall back to vault notes
          const browse = this.actionBtn(creatureWrap, "…");
          browse.title = "Search bestiary";
          browse.style.cssText += "padding:3px 7px;flex-shrink:0;";
          browse.onclick = () => {
            new BestiarySuggestModal(this.app, (monster) => {
              cr.creature      = monster.name;
              creatureIn.value = monster.name;
              if (!cr.hp && monster.hp !== undefined) {
                cr.hp = String(monster.hp); hpIn.value = cr.hp;
              }
              const ac = resolveAC(monster.ac);
              if (!cr.ac && ac !== null) {
                cr.ac = String(ac); acIn.value = cr.ac;
              }
              if (!cr.displayName) displayIn.placeholder = monster.name;
            }).open();
          };

          // Display name
          const displayIn = this.styledInput(row, cr.displayName, cr.creature || "Display name");
          displayIn.oninput = () => { cr.displayName = displayIn.value; };

          // HP
          const hpIn = this.styledInput(row, cr.hp, "—");
          hpIn.type = "number"; hpIn.style.textAlign = "center";
          hpIn.oninput = () => { cr.hp = hpIn.value; };

          // AC
          const acIn = this.styledInput(row, cr.ac, "—");
          acIn.type = "number"; acIn.style.textAlign = "center";
          acIn.oninput = () => { cr.ac = acIn.value; };

          // Count
          const countIn = this.styledInput(row, String(cr.count), "1");
          countIn.type = "number"; countIn.style.textAlign = "center";
          countIn.oninput = () => { cr.count = Math.max(1, parseInt(countIn.value) || 1); };

          // Delete
          const del = this.deleteBtn(row);
          del.onclick = () => { this.creatures.splice(i, 1); renderCreatures(); };
        });

        const addRow = list.createDiv();
        addRow.style.cssText = "margin-top: 2px;";
        const addBtn = this.addBtn(addRow, "+ Add Creature");
        addBtn.onclick = () => {
          this.creatures.push({ creature: "", displayName: "", hp: "", ac: "", count: 1 });
          renderCreatures();
          // Focus the new creature name input
          setTimeout(() => {
            const inputs = list.querySelectorAll("input");
            const last = inputs[inputs.length - 5] as HTMLInputElement;
            last?.focus();
          }, 10);
        };
      };

      renderCreatures();
    });

    // ── Preview ───────────────────────────────────────────────────────────────
    this.section(body, "Preview", (s) => {
      const pre = s.createEl("pre");
      pre.style.cssText =
        "background:var(--code-background);border:1px solid var(--background-modifier-border);" +
        "border-radius:var(--radius-m);padding:12px;font-size:var(--font-ui-smaller);" +
        "color:var(--code-normal);overflow-x:auto;margin:0;line-height:1.6;white-space:pre;";
      const update = () => { pre.textContent = this.buildMarkdown(); };
      update();
      // Refresh preview on any input change in the body
      body.addEventListener("input", update);
      body.addEventListener("click", () => setTimeout(update, 50));
    });

    // ── Footer / Save ─────────────────────────────────────────────────────────
    const footer = el.createDiv();
    footer.style.cssText =
      "padding:12px 20px;border-top:1px solid var(--background-modifier-border);" +
      "display:flex;justify-content:flex-end;gap:8px;" +
      "background:var(--background-primary);position:sticky;bottom:0;";

    const cancel = footer.createEl("button", { text: "Cancel" });
    cancel.addClass("mod-muted");
    cancel.onclick = () => this.close();

    const save = footer.createEl("button", { text: "Save Encounter Note" });
    save.addClass("mod-cta");
    save.onclick = () => this.save();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private section(parent: HTMLElement, title: string, fn: (s: HTMLElement) => void) {
    const wrap = parent.createDiv();
    wrap.style.cssText = "display:flex;flex-direction:column;gap:8px;";
    const lbl = wrap.createDiv({ text: title });
    lbl.style.cssText =
      "font-size:var(--font-ui-smaller);letter-spacing:0.08em;text-transform:uppercase;" +
      "color:var(--text-faint);border-bottom:1px solid var(--background-modifier-border);padding-bottom:5px;";
    fn(wrap);
  }

  private field(parent: HTMLElement, label: string, value: string, onChange: (v: string) => void, placeholder = "") {
    const wrap = parent.createDiv();
    wrap.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
    const lbl = wrap.createEl("label", { text: label });
    lbl.style.cssText = "font-size:var(--font-ui-smaller);color:var(--text-muted);margin-bottom:2px;";
    const inp = this.styledInput(wrap, value, placeholder);
    inp.oninput = () => onChange(inp.value);
    return inp;
  }

  private styledInput(parent: HTMLElement, value: string, placeholder = ""): HTMLInputElement {
    const el = parent.createEl("input");
    el.value = value;
    el.placeholder = placeholder;
    el.addClass("vtt-input");
    el.style.cssText =
      "background:var(--background-modifier-form-field);border:1px solid var(--background-modifier-border);" +
      "border-radius:var(--radius-s);color:var(--text-normal);padding:4px 8px;" +
      "font-size:var(--font-ui-small);outline:none;width:100%;box-sizing:border-box;";
    el.onfocus = () => { el.style.borderColor = "var(--interactive-accent)"; };
    el.onblur  = () => { el.style.borderColor = "var(--background-modifier-border)"; };
    return el;
  }

  private actionBtn(parent: HTMLElement, label: string): HTMLButtonElement {
    const b = parent.createEl("button", { text: label });
    b.style.cssText =
      "background:var(--background-modifier-hover);border:1px solid var(--background-modifier-border);" +
      "border-radius:var(--radius-s);color:var(--text-muted);padding:4px 9px;cursor:pointer;" +
      "font-size:var(--font-ui-smaller);white-space:nowrap;";
    b.onmouseenter = () => { b.style.color = "var(--text-normal)"; };
    b.onmouseleave = () => { b.style.color = "var(--text-muted)"; };
    return b as HTMLButtonElement;
  }

  private addBtn(parent: HTMLElement, label: string): HTMLButtonElement {
    const b = parent.createEl("button", { text: label });
    b.style.cssText =
      "background:transparent;border:1px dashed var(--background-modifier-border);" +
      "border-radius:var(--radius-s);color:var(--text-faint);padding:5px 12px;" +
      "cursor:pointer;width:100%;font-size:var(--font-ui-smaller);";
    b.onmouseenter = () => { b.style.borderColor = "var(--interactive-accent)"; b.style.color = "var(--interactive-accent)"; };
    b.onmouseleave = () => { b.style.borderColor = "var(--background-modifier-border)"; b.style.color = "var(--text-faint)"; };
    return b as HTMLButtonElement;
  }

  private deleteBtn(parent: HTMLElement): HTMLButtonElement {
    const b = parent.createDiv({ cls: "clickable-icon" }) as unknown as HTMLButtonElement;
    b.style.cssText = "display:flex;align-items:center;justify-content:center;cursor:pointer;padding:4px;border-radius:var(--radius-s);color:var(--text-faint);flex-shrink:0;";
    setIcon(b as unknown as HTMLElement, "x");
    b.onmouseenter = () => { (b as unknown as HTMLElement).style.color = "var(--text-error)"; };
    b.onmouseleave = () => { (b as unknown as HTMLElement).style.color = "var(--text-faint)"; };
    return b;
  }

  // ── Markdown generation ───────────────────────────────────────────────────

  buildMarkdown(): string {
    const lines: string[] = ["---"];

    // vtt-board links this note to a VTT board with the same name
    lines.push(`vtt-board: "${this.noteName.trim() || "New Encounter"}"`);

    if (this.mapPath.trim()) {
      lines.push(`map: "${this.mapPath.trim()}"`);
    }

    if (this.players.length > 0) {
      const valid = this.players.filter(p => p.trim());
      if (valid.length > 0) {
        lines.push("players:");
        valid.forEach(p => lines.push(`  - "${p.trim()}"`));
      }
    }

    lines.push("---", "");
    lines.push(`# ${this.noteName || "New Encounter"}`, "");

    // Encounter block
    if (this.creatures.length > 0) {
      lines.push("```encounter");
      lines.push(`name: ${this.noteName || "Encounter"}`);
      lines.push("creatures:");
      this.creatures.forEach(cr => {
        if (!cr.creature.trim()) return;
        const name    = cr.creature.trim();
        const display = cr.displayName.trim();
        const hp      = cr.hp.trim();
        const ac      = cr.ac.trim();
        const count   = cr.count || 1;

        if (display && display !== name) {
          // Object form for renamed creatures
          for (let i = 0; i < count; i++) {
            const dname = count > 1 ? `${display} ${i + 1}` : display;
            lines.push(`  - creature: ${name}`);
            lines.push(`    name: ${dname}`);
            if (hp) lines.push(`    hp: ${hp}`);
            if (ac) lines.push(`    ac: ${ac}`);
          }
        } else {
          // Simple form
          const stats = [hp || "", ac || ""].filter(Boolean);
          const statStr = stats.length > 0 ? `, ${stats.join(", ")}` : "";
          lines.push(`  - ${count > 1 ? count + ": " : ""}${name}${statStr}`);
        }
      });
      lines.push("```");
    }

    // Board button card — renders as a clickable "Open Board" card in reading view
    lines.push("", "```vtt-board");
    lines.push(this.noteName.trim() || "New Encounter");
    lines.push("```");

    return lines.join("\n");
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async save() {
    const name = this.noteName.trim() || "New Encounter";
    const folder = this.saveFolder.trim();
    const filename = name.endsWith(".md") ? name : `${name}.md`;
    const path = folder ? `${folder}/${filename}` : filename;

    const content = this.buildMarkdown();

    try {
      // Create folder if needed
      if (folder) {
        const folderExists = this.app.vault.getAbstractFileByPath(folder);
        if (!folderExists) await this.app.vault.createFolder(folder);
      }

      // Create or overwrite
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, content);
        new Notice(`Updated: ${path}`);
      } else {
        const file = await this.app.vault.create(path, content);
        new Notice(`Created: ${path}`);
        // Open the new note
        await this.app.workspace.getLeaf(false).openFile(file);
      }
      this.close();
    } catch (e) {
      new Notice(`Error saving: ${e}`);
    }
  }
}

// ─── Rename Board Modal ───────────────────────────────────────────────────────

class RenameBoardModal extends Modal {
  constructor(app: App, private current: string, private onRename: (name: string) => void) {
    super(app);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Rename Board" }).style.marginTop = "0";
    const inp = contentEl.createEl("input");
    inp.type = "text";
    inp.value = this.current;
    inp.style.cssText =
      "width:100%;background:var(--background-modifier-form-field);" +
      "border:1px solid var(--background-modifier-border);" +
      "border-radius:var(--radius-s);color:var(--text-normal);padding:6px 8px;" +
      "font-size:var(--font-ui-small);box-sizing:border-box;margin-bottom:12px;";
    const row = contentEl.createDiv();
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
    const ok = row.createEl("button", { text: "Rename" });
    ok.addClass("mod-cta");
    ok.onclick = () => {
      const name = inp.value.trim();
      if (name) { this.onRename(name); this.close(); }
    };
    const cancel = row.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    inp.onkeydown = e => { if (e.key === "Enter") ok.click(); if (e.key === "Escape") this.close(); };
    setTimeout(() => { inp.focus(); inp.select(); }, 10);
  }
  onClose() { this.contentEl.empty(); }
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

class VTTSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: VTTPlugin) { super(app, plugin); }
  display() {
    const { containerEl, plugin } = this;
    // Use the active board's settings as defaults
    const activeBoard = plugin.vttSettings.boards[plugin.vttSettings.activeBoardIndex]
                     ?? plugin.vttSettings.boards[0];
    const { board } = activeBoard;
    containerEl.empty();
    containerEl.createEl("h2", { text: "VTT Board" });

    new Setting(containerEl).setName("Default grid type")
      .addDropdown(d => d
        .addOption("square",     "Square")
        .addOption("hex-flat",   "Hex (Flat-top)")
        .addOption("hex-pointy", "Hex (Pointy-top)")
        .setValue(board.gridType)
        .onChange(v => { board.gridType = v as BoardSettings["gridType"]; plugin.saveVTTSettings(); }));

    new Setting(containerEl)
      .setName("Cell size (px)")
      .setDesc("Size of one grid cell in world-space pixels. Background image is independent — use Align BG mode to match it.")
      .addSlider(s => s.setLimits(10, 200, 1).setValue(board.cellSize)
        .setDynamicTooltip()
        .onChange(v => { board.cellSize = v; plugin.saveVTTSettings(); }));

    new Setting(containerEl).setName("Columns")
      .addText(t => t.setValue(String(board.cols))
        .onChange(v => { const n = parseInt(v); if (n > 0) { board.cols = n; plugin.saveVTTSettings(); } }));

    new Setting(containerEl).setName("Rows")
      .addText(t => t.setValue(String(board.rows))
        .onChange(v => { const n = parseInt(v); if (n > 0) { board.rows = n; plugin.saveVTTSettings(); } }));

    new Setting(containerEl).setName("Grid color")
      .addColorPicker(c => c.setValue(board.gridColor)
        .onChange(v => { board.gridColor = v; plugin.saveVTTSettings(); }));

    new Setting(containerEl).setName("Grid opacity")
      .addSlider(s => s.setLimits(0, 1, 0.05).setValue(board.gridOpacity)
        .setDynamicTooltip()
        .onChange(v => { board.gridOpacity = v; plugin.saveVTTSettings(); }));

    new Setting(containerEl).setName("Open VTT Board")
      .addButton(b => b.setButtonText("Open").onClick(() => plugin.activateView()));
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class VTTPlugin extends Plugin {
  vttSettings!: VTTSettings;

  async onload() {
    await this.loadVTTSettings();
    this.registerView(VTT_VIEW_TYPE, leaf => new VTTView(leaf, this));
    this.addRibbonIcon("layout-grid", "Open VTT Board", () => this.activateView());
    this.addCommand({ id: "open-vtt-board",        name: "Open VTT Board",                       callback: () => this.activateView() });
    this.addCommand({ id: "load-encounter-note",   name: "VTT: Load encounter from active note", callback: () => this.loadEncounterFromActiveNote() });
    this.addCommand({ id: "open-encounter-builder",name: "VTT: Open encounter builder",          callback: () => new EncounterBuilderModal(this.app, this).open() });
    this.addCommand({ id: "open-board-for-note",   name: "VTT: Open board linked in this note",  callback: () => this.openBoardForActiveNote() });
    this.addSettingTab(new VTTSettingTab(this.app, this));

    // ── Protocol handler: obsidian://vtt?board=Board+Name ─────────────────
    this.registerObsidianProtocolHandler("vtt", (params) => {
      const name = params.board ?? params.name;
      if (name) this.openBoardByName(decodeURIComponent(name));
      else this.activateView();
    });


    // ── Markdown post-processor: VTT links → open buttons ─────────────────
    //
    // Handles two syntaxes:
    //   [[VTT:Board Name]]   — wikilink (Obsidian renders as unresolved internal-link)
    //   `VTT:Board Name`     — inline code (reliable, always rendered verbatim)
    //
    // The wikilink form is caught by checking data-href on <a> elements.
    // The inline-code form is caught by matching <code> text content.
    this.registerMarkdownPostProcessor((el, ctx) => {
      // Resolve the source file once for all buttons in this block
      const sourceFile = ctx.sourcePath
        ? this.app.vault.getAbstractFileByPath(ctx.sourcePath) as TFile | null
        : null;

      // ── Wikilink form: [[VTT:Board Name]] ──────────────────────────────
      el.querySelectorAll("a.internal-link").forEach(a => {
        const dataHref = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
        const match = dataHref.match(/^VTT:\s*(.+)$/i);
        if (!match) return;
        a.replaceWith(this.makeBoardButton(match[1].trim(), sourceFile ?? undefined));
      });

      // ── Inline code form: `VTT:Board Name` ───────────────────────────
      el.querySelectorAll("code").forEach(code => {
        const match = (code.textContent ?? "").match(/^VTT:\s*(.+)$/i);
        if (!match) return;
        code.replaceWith(this.makeBoardButton(match[1].trim(), sourceFile ?? undefined));
      });
    });

    // ── Code block: ```vtt-board\nBoard Name\n``` → card button ──────────
    this.registerMarkdownCodeBlockProcessor("vtt-board", (source, el, ctx) => {
      const boardName  = source.trim();
      if (!boardName) return;
      const sourceFile = ctx.sourcePath
        ? this.app.vault.getAbstractFileByPath(ctx.sourcePath) as TFile | null
        : null;

      const card = el.createDiv();
      card.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;" +
        "background:var(--background-secondary);border:1px solid var(--background-modifier-border);" +
        "border-radius:var(--radius-l);padding:12px 16px;margin:4px 0;gap:12px;";

      const left = card.createDiv();
      left.style.cssText = "display:flex;align-items:center;gap:10px;min-width:0;";
      const iconWrap = left.createDiv();
      iconWrap.style.cssText =
        "display:flex;align-items:center;justify-content:center;" +
        "width:32px;height:32px;border-radius:var(--radius-m);" +
        "background:var(--interactive-accent);color:var(--text-on-accent);flex-shrink:0;";
      setIcon(iconWrap, "layout-grid");

      const textWrap = left.createDiv();
      textWrap.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0;";
      const nameEl = textWrap.createDiv({ text: boardName });
      nameEl.style.cssText =
        "font-weight:600;color:var(--text-normal);font-size:var(--font-ui-medium);" +
        "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

      // Show board status: exists? how many tokens?
      const existing = this.vttSettings.boards.find(b => b.name === boardName);
      const subEl = textWrap.createDiv();
      subEl.style.cssText = "font-size:var(--font-ui-smaller);color:var(--text-muted);";
      if (existing) {
        const t = existing.tokens.length;
        subEl.textContent = `${t} token${t !== 1 ? "s" : ""} · VTT Board`;
      } else {
        subEl.textContent = "New board — will be created on open";
      }

      const btn = card.createEl("button");
      btn.style.cssText =
        "display:inline-flex;align-items:center;gap:6px;flex-shrink:0;" +
        "background:var(--interactive-accent);color:var(--text-on-accent);" +
        "border:none;border-radius:var(--radius-m);padding:6px 14px;" +
        "cursor:pointer;font-size:var(--font-ui-small);font-family:inherit;" +
        "white-space:nowrap;";
      const btnIcon = btn.createSpan();
      setIcon(btnIcon, "external-link");
      btnIcon.style.cssText = "display:flex;align-items:center;";
      btn.createSpan({ text: "Open Board" });
      btn.onclick = () => this.openBoardByName(boardName, sourceFile ?? undefined);
    });

    // ── File open: inject board button if note has vtt-board frontmatter ──
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (!file) return;
      // Debounce slightly so the view has rendered
      setTimeout(() => this.injectFrontmatterButton(file), 80);
    }));
  }

  /** Create a small inline button that opens a named board. */
  private makeBoardButton(boardName: string, sourceFile?: TFile): HTMLElement {
    const btn = createEl("button");
    btn.addClass("vtt-board-link");
    btn.style.cssText =
      "display:inline-flex;align-items:center;gap:5px;" +
      "background:var(--interactive-accent);color:var(--text-on-accent);" +
      "border:none;border-radius:var(--radius-m);padding:2px 10px 2px 7px;" +
      "cursor:pointer;font-size:var(--font-ui-small);font-family:inherit;" +
      "vertical-align:middle;";
    const iconEl = btn.createSpan();
    setIcon(iconEl, "layout-grid");
    iconEl.style.cssText = "display:flex;align-items:center;";
    btn.createSpan({ text: boardName });
    btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.openBoardByName(boardName, sourceFile); };
    return btn;
  }

  /** Load the initiative tracker for the named board by finding its encounter note. */
  async loadITForBoard(boardName: string) {
    const encounterFile = await this.resolveEncounterFile(boardName);
    if (!encounterFile) return; // no encounter note found — leave IT as-is
    const parser  = new EncounterParser(this.app);
    const parsed  = await parser.parse(encounterFile);
    await this.loadMonstersIntoTracker(parsed.creatures);
  }

  /**
   * Open VTT and switch to the named board.
   *
   * Decision tree:
   * 1. Board exists → switch to it, done.
   * 2. Board missing + we have a source file:
   *    a. Source file is an encounter note (has an encounter block) → load from it.
   *    b. Source file is NOT an encounter note (e.g. a hub page) →
   *       search the vault for a note whose basename or vtt-board property matches.
   * 3. Board missing + no source file → search vault by name.
   * 4. Nothing found → create an empty board.
   */
  async openBoardByName(name: string, sourceFile?: TFile) {
    const idx = this.vttSettings.boards.findIndex(b => b.name === name);

    if (idx !== -1) {
      // Board exists — switch to it
      this.vttSettings.activeBoardIndex = idx;
      await this.saveVTTSettings();
      await this.activateView();
      const view = this.app.workspace.getLeavesOfType(VTT_VIEW_TYPE)[0]?.view as VTTView | undefined;
      if (view) { view.rebuildBoardSel(); view.markDirty(); }

      // Also reload the initiative tracker for this encounter
      await this.loadITForBoard(name);
      return;
    }

    // Board does not exist — find the encounter note to load from
    const encounterFile = await this.resolveEncounterFile(name, sourceFile);

    if (encounterFile) {
      new Notice(`Loading encounter "${name}"...`);
      await this.loadEncounterFromActiveNoteFile(encounterFile);
    } else {
      // Truly nothing found — create empty board
      this.vttSettings.boards.push(makeBoard(name));
      this.vttSettings.activeBoardIndex = this.vttSettings.boards.length - 1;
      await this.saveVTTSettings();
      await this.activateView();
      const view = this.app.workspace.getLeavesOfType(VTT_VIEW_TYPE)[0]?.view as VTTView | undefined;
      if (view) { view.rebuildBoardSel(); view.markDirty(); }
      new Notice(`Created new board "${name}"`);
    }
  }

  /**
   * Find the best encounter note for a given board name.
   * Checks in order:
   *   1. sourceFile itself, if it contains an ```encounter``` block
   *   2. Any vault note whose basename exactly matches name
   *   3. Any vault note whose vtt-board frontmatter matches name
   */
  private async resolveEncounterFile(name: string, sourceFile?: TFile): Promise<TFile | null> {
    const isEncounterNote = async (file: TFile): Promise<boolean> => {
      try {
        const content = await this.app.vault.cachedRead(file);
        return content.includes("```encounter");
      } catch { return false; }
    };

    // 1. Source file itself
    if (sourceFile && await isEncounterNote(sourceFile)) return sourceFile;

    // 2. Exact basename match anywhere in the vault
    const byBasename = this.app.vault.getMarkdownFiles()
      .find(f => f.basename === name);
    if (byBasename) return byBasename;

    // 3. vtt-board frontmatter match
    const byFrontmatter = this.app.vault.getMarkdownFiles().find(f => {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
      const boardProp = fm["vtt-board"] ?? fm["vttBoard"] ?? fm["vtt_board"];
      return boardProp && String(boardProp).trim() === name;
    });
    if (byFrontmatter) return byFrontmatter;

    return null;
  }

  /** Open the board linked in the active note's vtt-board frontmatter. */
  async openBoardForActiveNote() {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice("No active note."); return; }
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const name = fm["vtt-board"] ?? fm["vttBoard"] ?? fm["vtt_board"];
    if (!name) { new Notice("No vtt-board property found in this note."); return; }
    await this.openBoardByName(String(name).trim(), file);
  }

  /**
   * If the currently open note has a `vtt-board` frontmatter key, inject
   * a small "Open Board" button into the rendered view's properties area.
   * We look for an existing injected button and replace it to avoid dupes.
   */
  private async injectFrontmatterButton(file: TFile) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const name = fm["vtt-board"] ?? fm["vttBoard"] ?? fm["vtt_board"];

    // Remove any previously injected button
    document.querySelectorAll(".vtt-fm-button").forEach(el => el.remove());

    if (!name) return;
    const boardName = String(name).trim();

    // Find the active markdown leaf's container
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view as any;
      if (view?.file?.path !== file.path) continue;
      const container = view.contentEl as HTMLElement | undefined;
      if (!container) continue;

      // Try to find the properties/frontmatter block to attach near
      const propertiesEl = container.querySelector(".metadata-container, .frontmatter, .cm-frontmatter");
      const targetEl     = propertiesEl ?? container.querySelector(".markdown-preview-section, .cm-content");
      if (!targetEl) continue;

      const wrap = createEl("div");
      wrap.addClass("vtt-fm-button");
      wrap.style.cssText =
        "display:flex;align-items:center;padding:6px 0 2px;";

      const btn = wrap.createEl("button");
      btn.style.cssText =
        "display:inline-flex;align-items:center;gap:6px;" +
        "background:var(--interactive-accent);color:var(--text-on-accent);" +
        "border:none;border-radius:var(--radius-m);padding:4px 12px 4px 8px;" +
        "cursor:pointer;font-size:var(--font-ui-small);font-family:inherit;";
      const iconEl = btn.createSpan();
      setIcon(iconEl, "layout-grid");
      iconEl.style.cssText = "display:flex;align-items:center;";
      btn.createSpan({ text: `Open board: ${boardName}` });
      btn.onclick = () => this.openBoardByName(boardName, file);

      targetEl.insertAdjacentElement("afterend", wrap);
      break;
    }
  }

  // ── Encounter loading ─────────────────────────────────────────────────────

  async loadEncounterFromActiveNote() {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice("No active note."); return; }
    await this.loadEncounterFromActiveNoteFile(file);
  }

  async loadEncounterFromActiveNoteFile(file: TFile) {
    const parser   = new EncounterParser(this.app);
    const parsed   = await parser.parse(file);

    // Find or create a board slot named after this encounter note.
    // This way loading the same note twice reuses the same board,
    // and different encounters each get their own slot.
    const encounterName = file.basename;
    let boardIndex = this.vttSettings.boards.findIndex(b => b.name === encounterName);
    if (boardIndex === -1) {
      this.vttSettings.boards.push(makeBoard(encounterName));
      boardIndex = this.vttSettings.boards.length - 1;
    }
    this.vttSettings.activeBoardIndex = boardIndex;
    const boardState = this.vttSettings.boards[boardIndex];

    // Reset this board's tokens and background
    boardState.tokens = [];
    boardState.board.backgroundImage = null;
    boardState.board.bgX = 0;
    boardState.board.bgY = 0;
    boardState.board.bgScale = 1;

    // Set background map
    if (parsed.mapUrl) {
      boardState.board.backgroundImage = parsed.mapUrl;
    }

    const tokens: Token[] = [];

    // ── Players ──────────────────────────────────────────────────────────
    for (const playerName of parsed.players) {
      // Try to find a vault note by name or path
      const noteFile = this.app.metadataCache.getFirstLinkpathDest(playerName, file.path)
                    ?? this.app.vault.getAbstractFileByPath(playerName) as TFile | null;
      if (noteFile && noteFile instanceof TFile) {
        const tok = await this.buildTokenFromFile(noteFile, "character");
        tokens.push(tok);
      } else {
        // No note found — create a simple named token
        tokens.push(await this.buildAnonymousToken(playerName, "character", null, null));
      }
    }

    // ── Creatures ─────────────────────────────────────────────────────────
    for (const c of parsed.creatures) {
      // Expand count (object form already pre-expanded to count=1 per entry,
      // but simple lines carry the count)
      for (let i = 0; i < c.count; i++) {
        const displayName = c.count > 1 ? `${c.name} ${i + 1}` : c.name;

        // Try to resolve to a vault note by creature/bestiary name
        const noteFile = this.app.metadataCache.getFirstLinkpathDest(c.creature, file.path)
                      ?? this.app.vault.getAbstractFileByPath(c.creature) as TFile | null;
        if (noteFile && noteFile instanceof TFile) {
          const tok = await this.buildTokenFromFile(noteFile, "monster");
          // Encounter block values override note frontmatter if provided
          tok.name  = displayName;
          if (c.hp  !== null) { tok.hp = c.hp; tok.maxHp = c.hp; }
          tokens.push(tok);
        } else {
          // No note — anonymous monster token with encounter stats
          tokens.push(await this.buildAnonymousToken(displayName, "monster", c.hp, c.ac));
        }
      }
    }

    boardState.tokens = tokens;
    await this.saveVTTSettings();

    // Open / refresh the board view
    await this.activateView();
    const view = this.app.workspace.getLeavesOfType(VTT_VIEW_TYPE)[0]?.view as VTTView | undefined;
    if (view) {
      view.rebuildBoardSel();
      view.onEncounterLoaded();
    }

    // Load monsters into the initiative tracker (players are auto-managed by IT)
    await this.loadMonstersIntoTracker(parsed.creatures);

    new Notice(`Loaded "${file.basename}" onto board "${encounterName}": ${tokens.length} token(s)`);
  }

  /**
   * Push the encounter's monsters into the Initiative Tracker.
   * Players are left untouched — IT manages them from its own settings.
   * Strategy: read current tracker state, drop all non-player combatants,
   * append new monsters, write back via tracker.set().
   */
  private async loadMonstersIntoTracker(creatures: EncounterCreature[]) {
    try {
      const it = (this.app as any).plugins?.plugins?.["initiative-tracker"];
      if (!it?.tracker?.new) return;

      // Reset encounter and load default party players
      it.tracker.new(it, { creatures: [] });

      if (creatures.length === 0) return;

      // Grab the Combatant class from an existing combatant (the player IT just loaded)
      // so we can construct proper instances that have toJSON etc.
      let current: any[] = [];
      it.tracker.subscribe((s: any) => { if (Array.isArray(s)) current = s; })();
      const CombatantClass = current[0]?.constructor;
      if (!CombatantClass) {
        new Notice("VTT: could not get Combatant class from initiative tracker");
        return;
      }

      // Build proper Combatant instances
      const monsters: any[] = [];
      for (const c of creatures) {
        for (let i = 0; i < c.count; i++) {
          const displayName = c.count > 1 ? `${c.name} ${i + 1}` : c.name;
          const bestiary    = await this.getBestiaryCreature(c.creature);
          const hp  = c.hp  ?? bestiary?.hp  ?? 0;
          const ac  = c.ac  ?? (bestiary ? resolveAC(bestiary.ac) ?? 0 : 0);
          const mod = c.mod ?? (bestiary ? (bestiary as any).modifier ?? 0 : 0);

          monsters.push(new CombatantClass({
            name:     displayName,
            hp:       hp,
            ac:       ac,
            modifier: mod,
            player:   false,
            friendly: false,
            hidden:   false,
            cr:       bestiary ? (bestiary as any).cr ?? "" : "",
          }));
        }
      }

      // Add monsters and roll initiatives
      await it.tracker.add(it, false, ...monsters);
      it.tracker.roll(it);

      // Open the tracker view
      if (typeof it.addTrackerView === "function") await it.addTrackerView();

    } catch (e) {
      console.warn("VTT: could not load into initiative tracker:", e);
      new Notice("VTT: failed to load initiative tracker — see console");
    }
  }

  /** Fetch a single creature from the fantasy-statblocks bestiary by name. */
  private async getBestiaryCreature(name: string): Promise<BestiaryMonster | null> {
    try {
      const plugin = (this.app as any).plugins?.plugins?.["obsidian-5e-statblocks"];
      if (!plugin?.api) return null;
      // getCreatureFromBestiary is synchronous in most versions
      if (typeof plugin.api.getCreatureFromBestiary === "function") {
        const c = plugin.api.getCreatureFromBestiary(name);
        if (c) return c;
      }
      // fallback: getCreature
      if (typeof plugin.api.getCreature === "function") {
        const c = await plugin.api.getCreature(name);
        if (c) return c;
      }
    } catch { /* ignore */ }
    return null;
  }

  /** Convert a D&D size string to a token grid-cell footprint. */
  private sizeFromString(size: string | undefined): number {
    switch (size?.toLowerCase().trim()) {
      case "tiny":        return 1; // tiny fits in 1 cell visually
      case "small":       return 1;
      case "medium":      return 1;
      case "large":       return 2;
      case "huge":        return 3;
      case "gargantuan":  return 4;
      default:            return 1;
    }
  }

  /** Build a Token from a vault note file, using its frontmatter. */
  private async buildTokenFromFile(file: TFile, defaultType: Token["type"]): Promise<Token> {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const view = this.app.workspace.getLeavesOfType(VTT_VIEW_TYPE)[0]?.view as VTTView | undefined;
    const portrait = view ? view.resolvePortrait(fm, file) : null;
    const hp    = fm.hp    !== undefined ? Number(fm.hp)    : undefined;
    const maxHp = fm.maxHp !== undefined ? Number(fm.maxHp)
                : fm["max-hp"] !== undefined ? Number(fm["max-hp"]) : hp;

    // Size: prefer frontmatter, then bestiary lookup
    let size = fm.size ? Math.max(1, Number(fm.size) || 1) : 0;
    if (!size) {
      const bestiary = await this.getBestiaryCreature(file.basename);
      size = bestiary?.size ? this.sizeFromString(bestiary.size) : 1;
    }

    return {
      id:         `tok_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      filePath:   file.path,
      name:       String(fm.name ?? file.basename),
      portrait,
      col: 0, row: 0,
      size,
      type:       fm.type === "monster" ? "monster" : fm.type === "character" ? "character" : defaultType,
      color:      String(fm.color ?? nextColor()),
      hp, maxHp,
      conditions: Array.isArray(fm.conditions) ? fm.conditions.map(String) : [],
    };
  }

  /** Build a token with no linked note (anonymous creature from encounter block). */
  private async buildAnonymousToken(name: string, type: Token["type"], hp: number | null, ac: number | null): Promise<Token> {
    // Look up size from the bestiary using the creature name
    const bestiary = await this.getBestiaryCreature(name);
    const size = bestiary?.size ? this.sizeFromString(bestiary.size) : 1;
    return {
      id:         `tok_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      filePath:   "",
      name,
      portrait:   null,
      col: 0, row: 0,
      size,
      type,
      color:      nextColor(),
      hp:         hp ?? undefined,
      maxHp:      hp ?? undefined,
      conditions: [],
    };
  }

  onunload() { this.app.workspace.detachLeavesOfType(VTT_VIEW_TYPE); }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VTT_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VTT_VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async loadVTTSettings() {
    const saved = (await this.loadData()) ?? {};

    // Migration: old format had { board, tokens } at top level
    if (saved.board !== undefined || saved.tokens !== undefined) {
      this.vttSettings = {
        boards: [{
          name:   "Board 1",
          board:  Object.assign({}, DEFAULT_BOARD, saved.board ?? {}),
          tokens: Array.isArray(saved.tokens) ? saved.tokens : [],
        }],
        activeBoardIndex: 0,
      };
      return;
    }

    // New format
    this.vttSettings = {
      boards: Array.isArray(saved.boards) && saved.boards.length > 0
        ? saved.boards.map((b: any) => ({
            name:   b.name ?? "Board",
            board:  Object.assign({}, DEFAULT_BOARD, b.board ?? {}),
            tokens: Array.isArray(b.tokens) ? b.tokens : [],
          }))
        : [makeBoard("Board 1")],
      activeBoardIndex: typeof saved.activeBoardIndex === "number" ? saved.activeBoardIndex : 0,
    };
  }

  async saveVTTSettings() { await this.saveData(this.vttSettings); }
}
