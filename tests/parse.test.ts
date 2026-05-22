/**
 * Pure function tests — no DB or Redis required.
 * Covers: parseTradeInput, level math, print numbers, formatting helpers.
 */
import { describe, it, expect } from "vitest";
import { parseTradeInput } from "../src/commands/economy/multitrade.js";
import { rollPrintNumber, qualityStars, formatPrint, formatEdition } from "../src/utils/codes.js";
import { xpForLevel, totalXpForLevel, levelFromTotalXp } from "../src/services/level.service.js";

// ─── parseTradeInput ─────────────────────────────────────

describe("parseTradeInput", () => {
  it("parses a single card code", () => {
    const result = parseTradeInput("aK7x2Q");
    expect(result).toEqual([{ type: "add_cards", codes: ["aK7x2Q"] }]);
  });

  it("parses comma-separated card codes into one batch", () => {
    const result = parseTradeInput("aK7x2Q, bR3m1P, cZ9w4K");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("add_cards");
    expect(result[0].codes).toEqual(["aK7x2Q", "bR3m1P", "cZ9w4K"]);
  });

  it("parses gold with g suffix", () => {
    const result = parseTradeInput("500g");
    expect(result).toEqual([{ type: "set_gold", gold: 500 }]);
  });

  it("parses gold with 'gold' suffix", () => {
    const result = parseTradeInput("500 gold");
    expect(result).toEqual([{ type: "set_gold", gold: 500 }]);
  });

  it("parses gold with 'Gold' suffix (case-insensitive)", () => {
    const result = parseTradeInput("1000Gold");
    expect(result).toEqual([{ type: "set_gold", gold: 1000 }]);
  });

  it("parses remove card with dash prefix", () => {
    const result = parseTradeInput("-aK7x2Q");
    expect(result).toEqual([{ type: "remove_card", codes: ["aK7x2Q"] }]);
  });

  it("parses remove gold", () => {
    const result = parseTradeInput("-gold");
    expect(result).toEqual([{ type: "remove_gold" }]);
  });

  it("parses -g as remove gold", () => {
    const result = parseTradeInput("-g");
    expect(result).toEqual([{ type: "remove_gold" }]);
  });

  it("parses mixed input: cards + gold", () => {
    const result = parseTradeInput("aK7x2Q, 500g");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: "add_cards", codes: ["aK7x2Q"] });
    expect(result[1]).toEqual({ type: "set_gold", gold: 500 });
  });

  it("parses mixed input: cards + remove card + gold", () => {
    const result = parseTradeInput("aK7x2Q, -bR3m1P, 200g");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "add_cards", codes: ["aK7x2Q"] });
    expect(result[1]).toEqual({ type: "remove_card", codes: ["bR3m1P"] });
    expect(result[2]).toEqual({ type: "set_gold", gold: 200 });
  });

  it("ignores empty input", () => {
    expect(parseTradeInput("")).toEqual([]);
    expect(parseTradeInput("   ")).toEqual([]);
  });

  it("ignores non-matching text (too long, spaces, special chars)", () => {
    expect(parseTradeInput("hello world this is a sentence")).toEqual([]);
    expect(parseTradeInput("@user#1234")).toEqual([]);
  });

  it("handles extra whitespace", () => {
    const result = parseTradeInput("  aK7x2Q ,  bR3m1P  ");
    expect(result).toHaveLength(1);
    expect(result[0].codes).toEqual(["aK7x2Q", "bR3m1P"]);
  });

  it("does not merge non-consecutive add_cards", () => {
    const result = parseTradeInput("aK7x2Q, 500g, bR3m1P");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "add_cards", codes: ["aK7x2Q"] });
    expect(result[1]).toEqual({ type: "set_gold", gold: 500 });
    expect(result[2]).toEqual({ type: "add_cards", codes: ["bR3m1P"] });
  });
});

// ─── Level Math ──────────────────────────────────────────

describe("xpForLevel", () => {
  it("level 1 requires 100 XP", () => {
    expect(xpForLevel(1)).toBe(100);
  });

  it("level 10 requires 1000 XP", () => {
    expect(xpForLevel(10)).toBe(1000);
  });

  it("scales linearly", () => {
    for (let i = 1; i <= 20; i++) {
      expect(xpForLevel(i)).toBe(i * 100);
    }
  });
});

describe("totalXpForLevel", () => {
  it("level 1 needs 0 total XP", () => {
    expect(totalXpForLevel(1)).toBe(0);
  });

  it("level 2 needs 100 total XP", () => {
    expect(totalXpForLevel(2)).toBe(100);
  });

  it("level 3 needs 300 total XP (100 + 200)", () => {
    expect(totalXpForLevel(3)).toBe(300);
  });

  it("is monotonically increasing", () => {
    let prev = 0;
    for (let i = 1; i <= 50; i++) {
      const curr = totalXpForLevel(i);
      expect(curr).toBeGreaterThanOrEqual(prev);
      prev = curr;
    }
  });
});

describe("levelFromTotalXp", () => {
  it("0 XP = level 1", () => {
    expect(levelFromTotalXp(0)).toBe(1);
  });

  it("99 XP = level 1 (not enough for level 2)", () => {
    expect(levelFromTotalXp(99)).toBe(1);
  });

  it("100 XP = level 2", () => {
    expect(levelFromTotalXp(100)).toBe(2);
  });

  it("300 XP = level 3", () => {
    expect(levelFromTotalXp(300)).toBe(3);
  });

  it("round-trips with totalXpForLevel", () => {
    for (let level = 1; level <= 50; level++) {
      const xp = totalXpForLevel(level);
      expect(levelFromTotalXp(xp)).toBe(level);
    }
  });

  it("XP just below threshold stays at previous level", () => {
    for (let level = 2; level <= 20; level++) {
      const xp = totalXpForLevel(level) - 1;
      expect(levelFromTotalXp(xp)).toBe(level - 1);
    }
  });
});

// ─── rollPrintNumber ─────────────────────────────────────

describe("rollPrintNumber", () => {
  it("returns a number >= 1", () => {
    for (let i = 0; i < 100; i++) {
      const print = rollPrintNumber(new Set(), null);
      expect(print).toBeGreaterThanOrEqual(1);
    }
  });

  it("never returns a taken print number", () => {
    const taken = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (let i = 0; i < 200; i++) {
      const print = rollPrintNumber(taken, null);
      expect(taken.has(print)).toBe(false);
    }
  });

  it("respects maxPrints cap", () => {
    const taken = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const print = rollPrintNumber(taken, 100);
      expect(print).toBeGreaterThanOrEqual(1);
      expect(print).toBeLessThanOrEqual(100);
      taken.add(print);
    }
  });

  it("overflows when all slots in maxPrints are taken", () => {
    const max = 5;
    const taken = new Set([1, 2, 3, 4, 5]);
    const print = rollPrintNumber(taken, max);
    expect(print).toBeGreaterThan(max);
  });

  it("distribution skews toward higher print numbers (statistical)", () => {
    const N = 10_000;
    let lowCount = 0; // prints <= 10% of range
    let highCount = 0; // prints >= 50% of range

    for (let i = 0; i < N; i++) {
      const print = rollPrintNumber(new Set(), 100);
      if (print <= 10) lowCount++;
      if (print >= 50) highCount++;
    }

    // Low prints (bottom 10%) should be rare: roughly < 1%
    // High prints (top 50%) should dominate: roughly > 70%
    expect(lowCount / N).toBeLessThan(0.05);
    expect(highCount / N).toBeGreaterThan(0.50);
  });
});

// ─── Formatting Helpers ──────────────────────────────────

describe("qualityStars", () => {
  it("maps all qualities correctly", () => {
    expect(qualityStars("damaged")).toBe("☆☆☆☆☆");
    expect(qualityStars("poor")).toBe("★☆☆☆☆");
    expect(qualityStars("good")).toBe("★★★☆☆");
    expect(qualityStars("excellent")).toBe("★★★★☆");
    expect(qualityStars("pristine")).toBe("★★★★★");
  });

  it("returns default for unknown quality", () => {
    expect(qualityStars("unknown")).toBe("★★★☆☆");
  });
});

describe("formatPrint", () => {
  it("formats with hash prefix", () => {
    expect(formatPrint(1)).toBe("#1");
    expect(formatPrint(42)).toBe("#42");
    expect(formatPrint(1000)).toBe("#1000");
  });
});

describe("formatEdition", () => {
  it("formats with ED prefix", () => {
    expect(formatEdition(1)).toBe("ED1");
    expect(formatEdition(10)).toBe("ED10");
  });
});

// ─── Collection Filter Parser ───────────────────────────

import { parseCollectionArgs } from "../src/services/card.service.js";

describe("parseCollectionArgs", () => {
  it("parses sort order", () => {
    expect(parseCollectionArgs(["o=print"]).sort).toBe("print");
    expect(parseCollectionArgs(["o=quality"]).sort).toBe("quality");
    expect(parseCollectionArgs(["o=name"]).sort).toBe("name");
    expect(parseCollectionArgs(["o=series"]).sort).toBe("series");
    expect(parseCollectionArgs(["o=newest"]).sort).toBe("newest");
    expect(parseCollectionArgs(["o=oldest"]).sort).toBe("oldest");
    expect(parseCollectionArgs(["o=p"]).sort).toBe("print");
    expect(parseCollectionArgs(["o=q"]).sort).toBe("quality");
    expect(parseCollectionArgs(["o=c"]).sort).toBe("name");
  });

  it("parses quality filters", () => {
    const { filter: f1 } = parseCollectionArgs(["q=4"]);
    expect(f1.quality).toBe("pristine");
    const { filter: f2 } = parseCollectionArgs(["q>2"]);
    expect(f2.qualityMin).toBe(3);
    const { filter: f3 } = parseCollectionArgs(["q<3"]);
    expect(f3.qualityMax).toBe(2);
  });

  it("parses print number filters", () => {
    const { filter: f1 } = parseCollectionArgs(["n=1"]);
    expect(f1.printExact).toBe(1);
    const { filter: f2 } = parseCollectionArgs(["n>5"]);
    expect(f2.printMin).toBe(5);
    const { filter: f3 } = parseCollectionArgs(["p<20"]);
    expect(f3.printMax).toBe(20);
  });

  it("parses tag filters", () => {
    expect(parseCollectionArgs(["t=fav"]).filter.tag).toBe("fav");
    expect(parseCollectionArgs(["t!=jojo"]).filter.tagNot).toBe("jojo");
    expect(parseCollectionArgs(["t=untagged"]).filter.untagged).toBe(true);
    expect(parseCollectionArgs(["t=ut"]).filter.untagged).toBe(true);
    expect(parseCollectionArgs(["t=none"]).filter.untagged).toBe(true);
  });

  it("parses character and series filters", () => {
    expect(parseCollectionArgs(["c=goku"]).filter.characterName).toBe("goku");
    expect(parseCollectionArgs(["s=naruto"]).filter.series).toBe("naruto");
  });

  it("parses cosmetic filters", () => {
    expect(parseCollectionArgs(["hex=1"]).filter.hasHex).toBe(true);
    expect(parseCollectionArgs(["hex=0"]).filter.hasHex).toBe(false);
    expect(parseCollectionArgs(["frame=1"]).filter.hasFrame).toBe(true);
    expect(parseCollectionArgs(["aura=y"]).filter.hasAura).toBe(true);
  });

  it("parses page", () => {
    expect(parseCollectionArgs(["pg=5"]).page).toBe(5);
  });

  it("handles multiple args together", () => {
    const { filter, sort, page } = parseCollectionArgs(["o=quality", "q=4", "t=fav", "s=naruto", "pg=2"]);
    expect(sort).toBe("quality");
    expect(filter.quality).toBe("pristine");
    expect(filter.tag).toBe("fav");
    expect(filter.series).toBe("naruto");
    expect(page).toBe(2);
  });

  it("returns defaults for empty args", () => {
    const { filter, sort, page } = parseCollectionArgs([]);
    expect(sort).toBe("newest");
    expect(page).toBe(1);
    expect(Object.keys(filter).length).toBe(0);
  });
});
