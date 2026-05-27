import { describe, it, expect } from "vitest";
import { App } from "obsidian";
import { resolveAC, makeBoard, nextColor } from "../src/core";
import { EncounterParser } from "../src/encounter-parser";

// EncounterParser's block-parsing methods are pure (they never touch `this.app`),
// so a bare mock App is enough to exercise them via the private API.
function parser(): any {
  return new EncounterParser(new App() as any);
}

describe("resolveAC", () => {
  it("returns null for missing AC", () => {
    expect(resolveAC(undefined)).toBeNull();
    expect(resolveAC(0 as any)).toBeNull(); // falsy guard
  });

  it("returns a plain number unchanged", () => {
    expect(resolveAC(15)).toBe(15);
  });

  it("reads the first entry of a statblock-style AC array", () => {
    expect(resolveAC([{ ac: 18 }, { ac: 12 }])).toBe(18);
  });

  it("handles an array of bare numbers", () => {
    expect(resolveAC([17] as any)).toBe(17);
  });

  it("returns null for an empty array", () => {
    expect(resolveAC([])).toBeNull();
  });
});

describe("makeBoard", () => {
  it("creates a board with the given name and no tokens", () => {
    const b = makeBoard("Cavern");
    expect(b.name).toBe("Cavern");
    expect(b.tokens).toEqual([]);
    expect(b.board.gridType).toBe("square");
    expect(b.board.cols).toBe(20);
  });

  it("copies DEFAULT_BOARD so boards don't share state", () => {
    const a = makeBoard("A");
    const b = makeBoard("B");
    a.board.cols = 99;
    expect(b.board.cols).toBe(20);
  });
});

describe("nextColor", () => {
  it("cycles through the palette and wraps around", () => {
    const first8 = Array.from({ length: 8 }, () => nextColor());
    expect(new Set(first8).size).toBe(8); // all distinct
    expect(nextColor()).toBe(first8[0]); // 9th call wraps to start
  });
});

describe("EncounterParser — creature line forms", () => {
  const one = (block: string) => parser().parseEncounterBlock(block);

  it("parses a bare creature name", () => {
    const [c] = one("creatures:\n  - Goblin");
    expect(c).toMatchObject({ creature: "Goblin", name: "Goblin", hp: null, ac: null, mod: null, count: 1 });
  });

  it("parses inline stats: name, hp, ac, mod", () => {
    const [c] = one("creatures:\n  - Goblin, 7, 15, 2");
    expect(c).toMatchObject({ name: "Goblin", hp: 7, ac: 15, mod: 2, count: 1 });
  });

  it("parses a count prefix without expanding the entry", () => {
    const [c] = one("creatures:\n  - 3: Orc, 15, 13");
    expect(c).toMatchObject({ name: "Orc", hp: 15, ac: 13, count: 3 });
  });

  it("parses a [[creature, alias]] wikilink with stats", () => {
    const [c] = one("creatures:\n  - [[Bugbear, Grunk]], 27, 16");
    expect(c).toMatchObject({ creature: "Bugbear", name: "Grunk", hp: 27, ac: 16, count: 1 });
  });

  it("expands a counted bracket form into numbered copies", () => {
    const out = one("creatures:\n  - 2: [Hobgoblin, Jeff], 11, 18");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ creature: "Hobgoblin", name: "Jeff 1", hp: 11, ac: 18, count: 1 });
    expect(out[1]).toMatchObject({ name: "Jeff 2", count: 1 });
  });

  it("parses the multi-line YAML object form", () => {
    const block = [
      "creatures:",
      "  - creature: Mage",
      "    name: Vex",
      "    hp: 40",
      "    ac: 12",
      "    mod: 5",
    ].join("\n");
    const [c] = one(block);
    expect(c).toMatchObject({ creature: "Mage", name: "Vex", hp: 40, ac: 12, mod: 5, count: 1 });
  });

  it("stops reading creatures at the next top-level key", () => {
    const block = "creatures:\n  - Goblin\nnotes: ignore me\n  - NotACreature";
    const out = one(block);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Goblin");
  });
});

describe("EncounterParser.extractCreatures", () => {
  it("aggregates creatures across multiple encounter code blocks", () => {
    const content = [
      "# Fight",
      "```encounter",
      "creatures:",
      "  - Goblin",
      "  - 3: Orc, 15, 13",
      "```",
      "Some prose.",
      "```encounter",
      "creatures:",
      "  - [[Bugbear, Grunk]], 27, 16",
      "```",
    ].join("\n");
    const out = parser().extractCreatures(content, { path: "Fight.md" });
    expect(out.map((c: any) => c.name)).toEqual(["Goblin", "Orc", "Grunk"]);
  });

  it("returns an empty list when there are no encounter blocks", () => {
    expect(parser().extractCreatures("just text", { path: "x.md" })).toEqual([]);
  });
});

describe("EncounterParser.extractPlayers", () => {
  const players = (fm: Record<string, unknown>) => parser().extractPlayers(fm);

  it("strips wikilinks and aliases from an array", () => {
    expect(players({ players: ["[[Alice]]", "Bob|B"] })).toEqual(["Alice", "Bob"]);
  });

  it("wraps a single player string in an array", () => {
    expect(players({ players: "[[Carol]]" })).toEqual(["Carol"]);
  });

  it("treats false / 'none' as no players", () => {
    expect(players({ players: false })).toEqual([]);
    expect(players({ players: "none" })).toEqual([]);
    expect(players({})).toEqual([]);
  });

  it("treats `true` as 'defer to settings' (empty here)", () => {
    expect(players({ players: true })).toEqual([]);
  });
});
