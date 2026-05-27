import { Modal, FuzzySuggestModal, Notice, setIcon, TFile, type App } from "obsidian";
import { IMAGE_EXTENSIONS, resolveAC } from "./core";
import type { Token, BoardState, BestiaryMonster, BuilderCreature } from "./types";
import type VTTPlugin from "../main";

// ─── Modals ───────────────────────────────────────────────────────────────────

export class NoteSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private cb: (f: TFile) => void) {
    super(app);
    this.setPlaceholder("Search for a character or monster note...");
  }
  getItems() { return this.app.vault.getMarkdownFiles(); }
  getItemText(f: TFile) { return f.path; }
  onChooseItem(f: TFile) { this.cb(f); }
}

export class ImageSuggestModal extends FuzzySuggestModal<TFile> {
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

export class ConfirmModal extends Modal {
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

export class TokenDetailModal extends Modal {
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

export class BoardSuggestModal extends FuzzySuggestModal<BoardState> {
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

export class BestiarySuggestModal extends FuzzySuggestModal<BestiaryMonster> {
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

export class EncounterBuilderModal extends Modal {
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

export class RenameBoardModal extends Modal {
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
