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

interface VTTSettings {
  board: BoardSettings;
  tokens: Token[];
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

const DEFAULT_SETTINGS: VTTSettings = {
  board: { ...DEFAULT_BOARD },
  tokens: [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TOKEN_COLORS = [
  "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71",
  "#1abc9c", "#3498db", "#9b59b6", "#e91e63",
];
let colorCursor = 0;
const nextColor = () => TOKEN_COLORS[colorCursor++ % TOKEN_COLORS.length];

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

// ─── VTT View ─────────────────────────────────────────────────────────────────

type InteractMode = "normal" | "align-bg";

class VTTView extends ItemView {
  private plugin: VTTPlugin;
  private get S()     { return this.plugin.vttSettings; }
  private get board() { return this.plugin.vttSettings.board; }

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
  private selToken: Token | null = null;

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

  async onOpen()  { this.buildUI(); this.startLoop(); }
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
      "display:flex;flex-direction:column;height:100%;background:#0d0f14;overflow:hidden;font-family:'Courier New',monospace;";

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
    hint.style.cssText = `
      display:none;align-items:center;gap:10px;padding:5px 12px;
      background:#1a0f2e;border-bottom:1px solid #7c3aed;color:#c4b5fd;
      font-size:11px;flex-shrink:0;
    `;
    hint.innerHTML =
      `<span style="font-size:16px">🎯</span>` +
      `<span><b>Align BG mode:</b> drag to move image &nbsp;|&nbsp; ` +
      `scroll to scale image &nbsp;|&nbsp; ` +
      `<b>Shift+scroll</b> fine-scale &nbsp;|&nbsp; ` +
      `click <b>Done</b> when aligned</span>`;
    this.alignHint = hint;
  }

  buildToolbar(parent: HTMLElement) {
    const bar = parent.createDiv();
    bar.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:5px 10px;" +
      "background:#131720;border-bottom:1px solid #1e2535;flex-wrap:wrap;flex-shrink:0;";

    const btn = (label: string, icon: string, tip: string, fn: () => void): HTMLElement => {
      const b = bar.createEl("button");
      b.innerHTML = `${icon} <span style="font-size:11px">${label}</span>`;
      b.title = tip;
      b.style.cssText =
        "background:#1e2535;border:1px solid #2a3450;border-radius:4px;color:#a0b4d0;" +
        "padding:4px 9px;cursor:pointer;font-family:'Courier New',monospace;" +
        "white-space:nowrap;transition:background .12s,color .12s;";
      b.onmouseenter = () => { b.style.background = "#2a3450"; b.style.color = "#e0e8ff"; };
      b.onmouseleave = () => { b.style.background = "#1e2535"; b.style.color = "#a0b4d0"; };
      b.onclick = fn;
      return b;
    };

    const sep = () => {
      const d = bar.createDiv();
      d.style.cssText = "width:1px;height:18px;background:#2a3450;flex-shrink:0;";
    };

    // ── Token / background ────────────────────────────────────────────────
    btn("Add Token", "⊕", "Add a character or monster to the board", () => this.openAddToken());
    btn("Load Encounter", "📜", "Load encounter from the currently active note", () => {
      this.plugin.loadEncounterFromActiveNote();
    });
    const followBtn = btn("Follow Initiative", "⚔️", "Follow the active combatant in the Initiative Tracker", () => {
      this.toggleFollow();
    });
    this.followBtnEl = followBtn;
    btn("Background", "🖼", "Set map background image", () => this.pickBackground());
    btn("Clear BG", "✖🖼", "Remove background image", () => {
      this.board.backgroundImage = null;
      this.plugin.saveVTTSettings();
      this.dirty = true;
    });

    sep();

    // ── Align BG button ───────────────────────────────────────────────────
    // Stored so we can toggle its appearance
    const alignBtn = btn("Align BG", "🎯",
      "Enter Align-BG mode: drag and scale the background image independently of the grid",
      () => this.toggleAlignMode()
    );
    this.alignBtnEl = alignBtn;

    // Reset BG transform
    btn("Reset BG", "↺🖼", "Reset background position and scale to default", () => {
      this.board.bgX = 0; this.board.bgY = 0; this.board.bgScale = 1;
      this.plugin.saveVTTSettings();
      this.dirty = true;
    });

    sep();

    // ── Grid type ─────────────────────────────────────────────────────────
    const sel = bar.createEl("select");
    sel.style.cssText =
      "background:#1e2535;border:1px solid #2a3450;border-radius:4px;color:#a0b4d0;" +
      "padding:4px 7px;cursor:pointer;font-size:12px;font-family:'Courier New',monospace;";
    ([
      ["square",     "▦ Squares"],
      ["hex-flat",   "⬡ Hex Flat"],
      ["hex-pointy", "⬡ Hex Pointy"],
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

    // ── Cell size ─────────────────────────────────────────────────────────
    const szW = bar.createDiv();
    szW.style.cssText = "display:flex;align-items:center;gap:4px;color:#a0b4d0;font-size:11px;";
    szW.createSpan({ text: "Cell:" });
    const szIn = szW.createEl("input", { type: "range" });
    szIn.min = "10"; szIn.max = "200"; szIn.step = "1";
    szIn.value = String(this.board.cellSize);
    szIn.style.cssText = "width:90px;accent-color:#4a9eff;cursor:pointer;";
    const szLbl = szW.createSpan({ text: `${this.board.cellSize}px` });
    szIn.oninput = () => {
      this.board.cellSize = parseInt(szIn.value);
      szLbl.textContent   = `${szIn.value}px`;
      this.plugin.saveVTTSettings();
      this.dirty = true;
    };

    sep();

    btn("Grid", "👁", "Toggle grid overlay", () => {
      this.board.showGrid = !this.board.showGrid;
      this.plugin.saveVTTSettings();
      this.dirty = true;
    });
    btn("Reset View", "⟳", "Reset viewport pan and zoom", () => {
      this.panX = 0; this.panY = 0; this.zoom = 1; this.dirty = true;
    });

    sep();

    btn("Clear Board", "🗑", "Remove all tokens", () => {
      new ConfirmModal(this.app, "Remove all tokens from the board?", () => {
        this.S.tokens = [];
        this.selToken = null; this.dragToken = null;
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
      this.alignBtnEl.style.background    = active ? "#4a1d96" : "#1e2535";
      this.alignBtnEl.style.borderColor   = active ? "#7c3aed" : "#2a3450";
      this.alignBtnEl.style.color         = active ? "#e0e8ff" : "#a0b4d0";
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
      ctx.fillStyle = "#141824";
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
    const isSel  = this.selToken?.id === token.id;

    let cx: number, cy: number, tr: number;
    if (isHex) {
      const c = this.hexCenter(token.col, token.row, r, pointy);
      cx = c.x; cy = c.y; tr = r * 0.82 * token.size;
    } else {
      cx = token.col * board.cellSize + board.cellSize * token.size / 2;
      cy = token.row * board.cellSize + board.cellSize * token.size / 2;
      tr = board.cellSize * token.size / 2 * 0.88;
    }

    const img = token.portrait ? this.loadImg(token.portrait) : null;

    // clipped body
    ctx.save();
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

    // border
    ctx.save();
    if (isSel) { ctx.shadowColor = token.color; ctx.shadowBlur = 12 / this.zoom; }
    ctx.beginPath(); ctx.arc(cx, cy, tr, 0, Math.PI * 2);
    ctx.strokeStyle = isSel ? "#ffffff" : token.color;
    ctx.lineWidth   = (isSel ? 2.5 : 1.5) / this.zoom;
    ctx.stroke();
    ctx.restore();

    // name label
    const fs = Math.max(8, board.cellSize * 0.17);
    ctx.save();
    ctx.font = `${fs}px 'Courier New'`;
    const tw = ctx.measureText(token.name).width;
    const lx = cx - tw / 2 - 3, ly = cy + tr + 2 / this.zoom;
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(lx, ly, tw + 6, fs + 4);
    ctx.fillStyle = "#e0e8ff";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(token.name, cx, ly + 2);
    ctx.restore();

    // HP bar
    if (token.maxHp !== undefined && token.maxHp > 0) {
      const bw  = tr * 2, bh = Math.max(3, board.cellSize * 0.06);
      const bx  = cx - tr, by = cy + tr + fs + 6 / this.zoom;
      const pct = Math.max(0, Math.min(1, (token.hp ?? token.maxHp) / token.maxHp));
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = pct > 0.5 ? "#2ecc71" : pct > 0.25 ? "#f39c12" : "#e74c3c";
      ctx.fillRect(bx, by, bw * pct, bh);
      ctx.restore();
    }

    // condition pips
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

  loadImg(src: string): HTMLImageElement | null {
    if (this.imgCache.has(src)) return this.imgCache.get(src)!;
    if (this.imgLoading.has(src)) return null;
    this.imgLoading.add(src);
    const img = new Image();
    img.onload  = () => { this.imgCache.set(src, img); this.imgLoading.delete(src); this.dirty = true; };
    img.onerror = () => { this.imgLoading.delete(src); console.warn("VTT: cannot load", src); };
    img.src = src;
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
      if (!this.selToken) return;
      e.preventDefault();

      const { board } = this;
      const isHex  = board.gridType !== "square";
      const pointy = board.gridType === "hex-pointy";
      const t      = this.selToken;

      if (isHex) {
        // Hex axial movement — depends on pointy vs flat and odd/even offset row/col
        const { dc, dr } = this.hexArrowDelta(e.key, t.col, t.row, pointy);
        t.col = Math.max(0, Math.min(board.cols - t.size, t.col + dc));
        t.row = Math.max(0, Math.min(board.rows - t.size, t.row + dr));
      } else {
        // Square grid: straightforward cardinal movement
        // Shift moves by token.size so large tokens step by their own footprint
        const step = e.shiftKey ? t.size : 1;
        if (e.key === "ArrowUp")    t.row = Math.max(0,                    t.row - step);
        if (e.key === "ArrowDown")  t.row = Math.min(board.rows - t.size,  t.row + step);
        if (e.key === "ArrowLeft")  t.col = Math.max(0,                    t.col - step);
        if (e.key === "ArrowRight") t.col = Math.min(board.cols - t.size,  t.col + step);
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
      const idx = this.selToken ? tokens.indexOf(this.selToken) : -1;
      const next = e.shiftKey
        ? (idx - 1 + tokens.length) % tokens.length
        : (idx + 1) % tokens.length;
      this.selToken = tokens[next];
      this.dirty = true;
      return;
    }

    // Escape: deselect
    if (e.key === "Escape") {
      this.selToken = null;
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

    if (button === 1 || (button === 0 && !token)) {
      this.isPanning  = true;
      this.panAnchorX = sx - this.panX;
      this.panAnchorY = sy - this.panY;
      this.canvas.style.cursor = "grabbing";
      return;
    }

    if (button === 0 && token) {
      this.selToken  = token;
      this.dragToken = token;
      const { board } = this;
      const isHex  = board.gridType !== "square";
      const pointy = board.gridType === "hex-pointy";
      const r      = board.cellSize / 2;
      let tcx: number, tcy: number;
      if (isHex) {
        const c = this.hexCenter(token.col, token.row, r, pointy);
        tcx = c.x; tcy = c.y;
      } else {
        tcx = token.col * board.cellSize + board.cellSize * token.size / 2;
        tcy = token.row * board.cellSize + board.cellSize * token.size / 2;
      }
      this.dragOffX = w.x - tcx;
      this.dragOffY = w.y - tcy;
      this.dirty = true;
    }
  }

  onMove(sx: number, sy: number) {
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
      const w  = this.screenToWorld(sx, sy);
      const wx = w.x - this.dragOffX;
      const wy = w.y - this.dragOffY;
      const { col, row } = this.worldToCell(wx, wy);
      const { board }    = this;
      const maxC = Math.max(0, board.cols - this.dragToken.size);
      const maxR = Math.max(0, board.rows - this.dragToken.size);
      this.dragToken.col = Math.max(0, Math.min(maxC, col));
      this.dragToken.row = Math.max(0, Math.min(maxR, row));
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
    if (token) this.openTokenEditor(token);
  }

  // ── Context menu ──────────────────────────────────────────────────────────

  openCtxMenu(token: Token, sx: number, sy: number) {
    this.closeCtxMenu();
    const menu = document.createElement("div");
    menu.style.cssText =
      `position:fixed;top:${sy}px;left:${sx}px;z-index:9999;` +
      `background:#131720;border:1px solid #2a3450;border-radius:6px;` +
      `padding:4px;min-width:170px;box-shadow:0 8px 28px rgba(0,0,0,0.65);` +
      `font-family:'Courier New',monospace;`;
    const row = (label: string, fn: () => void) => {
      const el = document.createElement("div");
      el.textContent = label;
      el.style.cssText =
        "padding:6px 12px;cursor:pointer;color:#a0b4d0;font-size:12px;border-radius:4px;user-select:none;";
      el.onmouseenter = () => { el.style.background = "#1e2535"; el.style.color = "#fff"; };
      el.onmouseleave = () => { el.style.background = ""; el.style.color = "#a0b4d0"; };
      el.onclick = () => { this.closeCtxMenu(); fn(); };
      menu.appendChild(el);
    };
    row("📄 Open note",         () => {
      const f = this.app.vault.getAbstractFileByPath(token.filePath) as TFile | null;
      if (f) this.app.workspace.getLeaf(false).openFile(f);
    });
    row("✏️ Edit token",        () => this.openTokenEditor(token));
    row("🔄 Refresh from note", () => this.refreshToken(token));
    row("✕ Remove",              () => {
      this.S.tokens = this.S.tokens.filter(t => t.id !== token.id);
      if (this.selToken?.id === token.id) this.selToken = null;
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

  pickBackground() {
    new ImageSuggestModal(this.app, file => {
      const url = this.app.vault.getResourcePath(file);
      // Reset bg transform when a new image is loaded so it starts at origin
      this.board.backgroundImage = url;
      this.board.bgX     = 0;
      this.board.bgY     = 0;
      this.board.bgScale = 1;
      this.imgCache.delete(url);
      this.imgLoading.delete(url);
      this.plugin.saveVTTSettings();
      this.dirty = true;
      new Notice(`Background: ${file.basename} — use "Align BG" to position it`);
    }).open();
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
      this.followBtnEl.style.background  = "#14532d";
      this.followBtnEl.style.borderColor = "#16a34a";
      this.followBtnEl.style.color       = "#86efac";
    }

    // Subscribe to the Svelte store.  Called immediately (may be undefined if
    // combat hasn't started yet) and on every subsequent state change.
    // We also try tracker.data as a synchronous snapshot in the same callback
    // since some versions only update .data and don't push to subscribers.
    const unsub: () => void = it.tracker.subscribe((storeValue: any) => {
      const arr: any[] | null = Array.isArray(storeValue) ? storeValue : null;
      if (!arr) return;

      const active = arr.find((combatant: any) => combatant.active === true);
      if (!active?.id) return;

      if (active.id === this.lastFollowId) return;
      this.lastFollowId = active.id;

      const displayName = String(active.display ?? active.name);

      // Rank = position of this combatant among all with the same display name in IT
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
      this.followBtnEl.style.background  = "#1e2535";
      this.followBtnEl.style.borderColor = "#2a3450";
      this.followBtnEl.style.color       = "#a0b4d0";
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
    this.selToken = token;

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
    if (this.board.backgroundImage) this.loadImg(this.board.backgroundImage);
    // Reset viewport so the full board is visible
    this.panX = 0; this.panY = 0; this.zoom = 1;
    this.selToken  = null;
    this.dragToken = null;
    this.dirty = true;
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

class EncounterParser {
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
      return f ? this.app.vault.getResourcePath(f) : null;
    }

    let text = String(raw).trim();
    if (text.startsWith("[[") && text.endsWith("]]")) text = text.slice(2, -2);
    const pipe = text.indexOf("|");
    if (pipe !== -1) text = text.slice(0, pipe).trim();
    if (!text) return null;

    const resolved = this.app.metadataCache.getFirstLinkpathDest(text, file.path);
    if (resolved) return this.app.vault.getResourcePath(resolved);
    const byPath = this.app.vault.getAbstractFileByPath(text) as TFile | null;
    if (byPath) return this.app.vault.getResourcePath(byPath);
    return text; // external URL
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

// ─── Settings tab ─────────────────────────────────────────────────────────────

class VTTSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: VTTPlugin) { super(app, plugin); }
  display() {
    const { containerEl, plugin } = this;
    const { board } = plugin.vttSettings;
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
    this.addCommand({ id: "open-vtt-board",       name: "Open VTT Board",                callback: () => this.activateView() });
    this.addCommand({ id: "load-encounter-note",  name: "VTT: Load encounter from active note", callback: () => this.loadEncounterFromActiveNote() });
    this.addSettingTab(new VTTSettingTab(this.app, this));
  }

  // ── Encounter loading ─────────────────────────────────────────────────────

  async loadEncounterFromActiveNote() {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice("No active note."); return; }

    const parser  = new EncounterParser(this.app);
    const parsed  = await parser.parse(file);

    // Reset board and tokens — keep grid settings
    this.vttSettings.tokens = [];
    this.vttSettings.board.backgroundImage = null;
    this.vttSettings.board.bgX = 0;
    this.vttSettings.board.bgY = 0;
    this.vttSettings.board.bgScale = 1;

    // Set background map
    if (parsed.mapUrl) {
      this.vttSettings.board.backgroundImage = parsed.mapUrl;
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
        tokens.push(this.buildAnonymousToken(playerName, "character", null, null));
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
          tokens.push(this.buildAnonymousToken(displayName, "monster", c.hp, c.ac));
        }
      }
    }

    this.vttSettings.tokens = tokens;
    await this.saveVTTSettings();

    // Open / refresh the board view
    await this.activateView();
    const view = this.app.workspace.getLeavesOfType(VTT_VIEW_TYPE)[0]?.view as VTTView | undefined;
    if (view) view.onEncounterLoaded();

    new Notice(`Loaded encounter from "${file.basename}": ${tokens.length} token(s)`);
  }

  /** Build a Token from a vault note file, using its frontmatter. */
  private async buildTokenFromFile(file: TFile, defaultType: Token["type"]): Promise<Token> {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const view = this.app.workspace.getLeavesOfType(VTT_VIEW_TYPE)[0]?.view as VTTView | undefined;
    const portrait = view ? view.resolvePortrait(fm, file) : null;
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
      type:       fm.type === "monster" ? "monster" : fm.type === "character" ? "character" : defaultType,
      color:      String(fm.color ?? nextColor()),
      hp, maxHp,
      conditions: Array.isArray(fm.conditions) ? fm.conditions.map(String) : [],
    };
  }

  /** Build a token with no linked note (anonymous creature from encounter block). */
  private buildAnonymousToken(name: string, type: Token["type"], hp: number | null, ac: number | null): Token {
    return {
      id:         `tok_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      filePath:   "",
      name,
      portrait:   null,
      col: 0, row: 0,
      size:       1,
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
    this.vttSettings = {
      board:  Object.assign({}, DEFAULT_BOARD, saved.board ?? {}),
      tokens: Array.isArray(saved.tokens) ? saved.tokens : [],
    };
  }

  async saveVTTSettings() { await this.saveData(this.vttSettings); }
}
