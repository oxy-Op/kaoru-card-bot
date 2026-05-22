/**
 * Unit tests for pure weighting functions: weightedRandom, rollQuality, eraMultiplier.
 * No DB required — these are purely mathematical.
 */
import { describe, it, expect } from "vitest";
import { weightedRandom, rollQuality } from "../src/utils/codes.js";
import { eraMultiplier } from "../src/services/summon.service.js";

// ─── eraMultiplier ──────────────────────────────────────

describe("eraMultiplier: popular characters (500+ favs)", () => {
  it("recent popular gets a slight boost (1.5x)", () => {
    expect(eraMultiplier(2024, 5000)).toBe(1.5);
    expect(eraMultiplier(2015, 1000)).toBe(1.5);
  });

  it("old popular stays at baseline (1.0x) — NOT penalised", () => {
    expect(eraMultiplier(1989, 10000)).toBe(1.0); // Dragon Ball Z
    expect(eraMultiplier(2000, 5000)).toBe(1.0);  // Naruto/One Piece era
    expect(eraMultiplier(1979, 2000)).toBe(1.0);  // Doraemon
    expect(eraMultiplier(1995, 800)).toBe(1.0);   // Evangelion
  });

  it("null year for popular = baseline (1.0x)", () => {
    expect(eraMultiplier(null, 1000)).toBe(1.0);
  });
});

describe("eraMultiplier: obscure characters (<500 favs)", () => {
  it("current obscure gets heavy boost (4.0x)", () => {
    expect(eraMultiplier(2024, 10)).toBe(4.0);
    expect(eraMultiplier(2020, 50)).toBe(4.0);
  });

  it("recent obscure gets boost (3.0x)", () => {
    expect(eraMultiplier(2019, 100)).toBe(3.0);
    expect(eraMultiplier(2015, 0)).toBe(3.0);
  });

  it("modern obscure gets moderate boost (2.0x)", () => {
    expect(eraMultiplier(2010, 30)).toBe(2.0);
    expect(eraMultiplier(2005, 5)).toBe(2.0);
  });

  it("classic obscure is baseline (1.0x)", () => {
    expect(eraMultiplier(2000, 10)).toBe(1.0);
    expect(eraMultiplier(1995, 0)).toBe(1.0);
  });

  it("retro obscure is suppressed (0.3x)", () => {
    expect(eraMultiplier(1985, 10)).toBe(0.3);
    expect(eraMultiplier(1960, 0)).toBe(0.3);
  });

  it("null year obscure = baseline (1.0x)", () => {
    expect(eraMultiplier(null, 0)).toBe(1.0);
  });
});

describe("eraMultiplier: key scenarios", () => {
  it("Dragon Ball (popular, old) is NOT penalised vs Chainsaw Man (popular, new)", () => {
    const dbz = eraMultiplier(1989, 15000);   // 1.0
    const csm = eraMultiplier(2022, 12000);   // 1.5
    // DBZ is at baseline, CSM gets a slight boost — but no harsh penalty
    expect(dbz).toBe(1.0);
    expect(csm).toBe(1.5);
    expect(csm / dbz).toBe(1.5); // only 1.5x difference, not 10x
  });

  it("obscure 1970s char IS suppressed vs obscure 2023 char", () => {
    const oldObscure = eraMultiplier(1975, 5);
    const newObscure = eraMultiplier(2023, 5);
    expect(newObscure / oldObscure).toBeCloseTo(4.0 / 0.3, 0); // ~13x
  });

  it("popular 1990s char appears MORE than obscure 1990s char (via rarity, not era)", () => {
    // Both get the same era multiplier — popularity difference comes from rarityWeight
    const popularEra = eraMultiplier(1998, 5000);
    const obscureEra = eraMultiplier(1998, 10);
    expect(popularEra).toBe(1.0);
    expect(obscureEra).toBe(1.0);
    // Same! The rarity difference is handled by rarityWeight, not era
  });
});

// ─── weightedRandom ─────────────────────────────────────

describe("weightedRandom", () => {
  it("always returns the only item when pool size is 1", () => {
    const items = [{ id: "a", weight: 1 }];
    for (let i = 0; i < 100; i++) {
      expect(weightedRandom(items).id).toBe("a");
    }
  });

  it("never selects an item with weight 0 (when others have weight)", () => {
    const items = [
      { id: "zero", weight: 0 },
      { id: "positive", weight: 10 },
    ];
    for (let i = 0; i < 500; i++) {
      expect(weightedRandom(items).id).toBe("positive");
    }
  });

  it("selects higher-weight items more often (statistical)", () => {
    const items = [
      { id: "heavy", weight: 9 },
      { id: "light", weight: 1 },
    ];
    const counts = { heavy: 0, light: 0 };
    const N = 10_000;

    for (let i = 0; i < N; i++) {
      counts[weightedRandom(items).id as "heavy" | "light"]++;
    }

    const heavyPct = counts.heavy / N;
    expect(heavyPct).toBeGreaterThan(0.85);
    expect(heavyPct).toBeLessThan(0.95);
  });

  it("respects proportional weights across 3+ items", () => {
    const items = [
      { id: "a", weight: 50 },
      { id: "b", weight: 30 },
      { id: "c", weight: 20 },
    ];
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    const N = 20_000;

    for (let i = 0; i < N; i++) {
      counts[weightedRandom(items).id]++;
    }

    expect(counts.a / N).toBeGreaterThan(0.45);
    expect(counts.a / N).toBeLessThan(0.55);
    expect(counts.b / N).toBeGreaterThan(0.25);
    expect(counts.b / N).toBeLessThan(0.35);
    expect(counts.c / N).toBeGreaterThan(0.15);
    expect(counts.c / N).toBeLessThan(0.25);
  });
});

// ─── rollQuality ────────────────────────────────────────

describe("rollQuality", () => {
  it("only returns valid quality values", () => {
    const valid = new Set(["damaged", "poor", "good", "excellent", "pristine"]);
    for (let i = 0; i < 1000; i++) {
      expect(valid.has(rollQuality())).toBe(true);
    }
  });

  it("distribution roughly matches expected rates over many rolls", () => {
    const N = 100_000;
    const counts: Record<string, number> = {
      damaged: 0, poor: 0, good: 0, excellent: 0, pristine: 0,
    };

    for (let i = 0; i < N; i++) {
      counts[rollQuality()]++;
    }

    const pct = (k: string) => counts[k] / N;

    expect(pct("damaged")).toBeGreaterThan(0.01);
    expect(pct("damaged")).toBeLessThan(0.04);
    expect(pct("poor")).toBeGreaterThan(0.05);
    expect(pct("poor")).toBeLessThan(0.12);
    expect(pct("good")).toBeGreaterThan(0.50);
    expect(pct("good")).toBeLessThan(0.60);
    expect(pct("excellent")).toBeGreaterThan(0.21);
    expect(pct("excellent")).toBeLessThan(0.29);
    expect(pct("pristine")).toBeGreaterThan(0.07);
    expect(pct("pristine")).toBeLessThan(0.14);
  });

  it("pristineBoost increases pristine rate", () => {
    const N = 50_000;
    let pristineNormal = 0;
    let pristineBoosted = 0;

    for (let i = 0; i < N; i++) {
      if (rollQuality(0) === "pristine") pristineNormal++;
      if (rollQuality(0.3) === "pristine") pristineBoosted++;
    }

    expect(pristineBoosted / N).toBeGreaterThan(pristineNormal / N * 1.5);
  });
});
