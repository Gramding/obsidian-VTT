// Parses an initiative-tracker encounter note into structured data.

import type { App, TFile } from "obsidian";
import type { EncounterCreature, ParsedEncounter } from "./types";

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
