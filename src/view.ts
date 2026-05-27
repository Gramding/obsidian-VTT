import { ItemView, Notice, setIcon, type WorkspaceLeaf, type TFile } from "obsidian";
import { VTT_VIEW_TYPE, makeBoard, nextColor } from "./core";
import type { Token, BoardSettings, InteractMode } from "./types";
import {
  ConfirmModal, TokenDetailModal, BoardSuggestModal,
  NoteSuggestModal, ImageSuggestModal, EncounterBuilderModal, RenameBoardModal,
} from "./modals";
import type VTTPlugin from "../main";

export class VTTView extends ItemView {
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
