import { Plugin, Notice, setIcon, TFile } from "obsidian";
import {
  VTT_VIEW_TYPE, makeBoard, nextColor, resolveAC, DEFAULT_BOARD,
} from "./src/core";
import type {
  VTTSettings, Token, EncounterCreature, BestiaryMonster,
} from "./src/types";
import { VTTView } from "./src/view";
import { EncounterParser } from "./src/encounter-parser";
import { EncounterBuilderModal } from "./src/modals";
import { VTTSettingTab } from "./src/settings-tab";

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
