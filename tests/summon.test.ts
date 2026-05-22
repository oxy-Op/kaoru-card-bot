/**
 * Summon tests — two layers:
 *
 * 1. "pool simulation" tests: construct a pool in memory like selectCharacters
 *    would, apply era/rarity/summon-list weights, run weightedRandom many times.
 *    Fast, deterministic, tests the math that matters.
 *
 * 2. "end-to-end" smoke tests: call performSummon against the real local DB
 *    to verify cards are created, qualities are valid, etc.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, seedCharacter, seedUser, seedGuild, cleanup, closeDb } from "./setup.js";
import { performSummon, eraMultiplier, grabCard } from "../src/services/summon.service.js";
import { weightedRandom } from "../src/utils/codes.js";
import { cards, fusionPileEntries, users } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { redis } from "../src/cache/index.js";

const TEST_GUILD = "test_guild_999999999";
const TEST_SUMMONER = "test_summoner_999999999";

// ─── Pool Simulation Helper ─────────────────────────────

interface SimChar {
  id: string;
  rarityWeight: number;
  seriesYear: number | null;
  popularity: number;
  onSummonList: boolean;
  weight: number;
}

/** Build a simulated pool and compute weights exactly like selectCharacters does. */
function buildPool(chars: Omit<SimChar, "weight">[]): (SimChar & { weight: number })[] {
  return chars.map((c) => ({
    ...c,
    weight: c.rarityWeight * eraMultiplier(c.seriesYear, c.popularity) * (c.onSummonList ? 2.0 : 1.0),
  }));
}

/** Run weighted selection N times on a pool, return counts per id. */
function simulate(pool: { id: string; weight: number }[], n: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const pick = weightedRandom(pool);
    counts.set(pick.id, (counts.get(pick.id) ?? 0) + 1);
  }
  return counts;
}

function groupTotal(counts: Map<string, number>, prefix: string): number {
  let total = 0;
  for (const [id, count] of counts) {
    if (id.startsWith(prefix)) total += count;
  }
  return total;
}

// ─── Pool Simulation: Popular chars are NOT penalised ───

describe("pool sim: popular classics vs popular modern", () => {
  // The whole point: DBZ and Doraemon should NOT be 10x rarer than Chainsaw Man
  const chars: Omit<SimChar, "weight">[] = [];
  for (let i = 0; i < 10; i++) {
    // Popular old (DBZ-tier): 1989, 15000 favs
    chars.push({ id: `pop_old_${i}`, rarityWeight: 0.05, seriesYear: 1989, popularity: 15000, onSummonList: false });
    // Popular new (CSM-tier): 2022, 12000 favs
    chars.push({ id: `pop_new_${i}`, rarityWeight: 0.05, seriesYear: 2022, popularity: 12000, onSummonList: false });
  }

  const pool = buildPool(chars);
  const N = 50_000;
  let counts: Map<string, number>;

  beforeAll(() => { counts = simulate(pool, N); });

  it("popular old and popular new appear at similar rates (not 10x gap)", () => {
    const oldTotal = groupTotal(counts, "pop_old_");
    const newTotal = groupTotal(counts, "pop_new_");
    const ratio = newTotal / oldTotal;

    // Old popular: 0.05 * 1.0 = 0.05, New popular: 0.05 * 1.5 = 0.075
    // Ratio should be ~1.5x, NOT 10x
    console.log(`  Popular old: ${oldTotal}, Popular new: ${newTotal}, ratio: ${ratio.toFixed(2)}x (expected ~1.5x)`);
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.8);
  });
});

// ─── Pool Simulation: Obscure old IS suppressed ─────────

describe("pool sim: obscure old vs obscure new", () => {
  const chars: Omit<SimChar, "weight">[] = [];
  for (let i = 0; i < 10; i++) {
    // Obscure retro (random 1970s char nobody knows)
    chars.push({ id: `obs_retro_${i}`, rarityWeight: 1.0, seriesYear: 1975, popularity: 5, onSummonList: false });
    // Obscure current (random 2023 seasonal char)
    chars.push({ id: `obs_new_${i}`, rarityWeight: 1.0, seriesYear: 2023, popularity: 10, onSummonList: false });
  }

  const pool = buildPool(chars);
  const N = 50_000;
  let counts: Map<string, number>;

  beforeAll(() => { counts = simulate(pool, N); });

  it("obscure current chars heavily dominate over obscure retro", () => {
    const retroTotal = groupTotal(counts, "obs_retro_");
    const newTotal = groupTotal(counts, "obs_new_");
    const ratio = newTotal / retroTotal;

    // 4.0 / 0.3 ≈ 13.3x
    console.log(`  Obscure new: ${newTotal}, Obscure retro: ${retroTotal}, ratio: ${ratio.toFixed(1)}x (expected ~13x)`);
    expect(ratio).toBeGreaterThan(10);
    expect(ratio).toBeLessThan(17);
  });

  it("obscure retro still appears (not zero)", () => {
    expect(groupTotal(counts, "obs_retro_")).toBeGreaterThan(0);
  });
});

// ─── Pool Simulation: Era weighting for obscure chars ───

describe("pool sim: era ordering for obscure characters", () => {
  const chars: Omit<SimChar, "weight">[] = [];
  for (let i = 0; i < 10; i++) {
    chars.push({ id: `obc_current_${i}`, rarityWeight: 1.0, seriesYear: 2024, popularity: 10, onSummonList: false });
    chars.push({ id: `obc_recent_${i}`, rarityWeight: 1.0, seriesYear: 2017, popularity: 10, onSummonList: false });
    chars.push({ id: `obc_modern_${i}`, rarityWeight: 1.0, seriesYear: 2010, popularity: 10, onSummonList: false });
    chars.push({ id: `obc_classic_${i}`, rarityWeight: 1.0, seriesYear: 2000, popularity: 10, onSummonList: false });
    chars.push({ id: `obc_retro_${i}`, rarityWeight: 1.0, seriesYear: 1985, popularity: 10, onSummonList: false });
  }

  const pool = buildPool(chars);
  const N = 50_000;
  let counts: Map<string, number>;

  beforeAll(() => { counts = simulate(pool, N); });

  it("ordering: current > recent > modern > classic > retro", () => {
    const current = groupTotal(counts, "obc_current_");
    const recent = groupTotal(counts, "obc_recent_");
    const modern = groupTotal(counts, "obc_modern_");
    const classic = groupTotal(counts, "obc_classic_");
    const retro = groupTotal(counts, "obc_retro_");

    console.log(`  current=${current} > recent=${recent} > modern=${modern} > classic=${classic} > retro=${retro}`);

    expect(current).toBeGreaterThan(recent);
    expect(recent).toBeGreaterThan(modern);
    expect(modern).toBeGreaterThan(classic);
    expect(classic).toBeGreaterThan(retro);
  });
});

// ─── Pool Simulation: Rarity weighting ──────────────────

describe("pool sim: rarity weighting", () => {
  const chars: Omit<SimChar, "weight">[] = [];
  for (let i = 0; i < 10; i++) {
    chars.push({ id: `legendary_${i}`, rarityWeight: 0.05, seriesYear: 2024, popularity: 15000, onSummonList: false });
    chars.push({ id: `epic_${i}`, rarityWeight: 0.15, seriesYear: 2024, popularity: 5000, onSummonList: false });
    chars.push({ id: `rare_${i}`, rarityWeight: 0.4, seriesYear: 2024, popularity: 1000, onSummonList: false });
    chars.push({ id: `common_${i}`, rarityWeight: 1.0, seriesYear: 2024, popularity: 10, onSummonList: false });
  }

  const pool = buildPool(chars);
  const N = 50_000;
  let counts: Map<string, number>;

  beforeAll(() => { counts = simulate(pool, N); });

  it("rarity ordering: common > rare > epic > legendary", () => {
    const common = groupTotal(counts, "common_");
    const rare = groupTotal(counts, "rare_");
    const epic = groupTotal(counts, "epic_");
    const legendary = groupTotal(counts, "legendary_");

    console.log(`  common=${common} > rare=${rare} > epic=${epic} > legendary=${legendary}`);

    expect(common).toBeGreaterThan(rare);
    expect(rare).toBeGreaterThan(epic);
    expect(epic).toBeGreaterThan(legendary);
  });
});

// ─── Pool Simulation: Summon list bonus ─────────────────

describe("pool sim: summon list bonus", () => {
  const chars: Omit<SimChar, "weight">[] = [];
  for (let i = 0; i < 20; i++) {
    chars.push({ id: `listed_${i}`, rarityWeight: 1.0, seriesYear: 2024, popularity: 10, onSummonList: true });
    chars.push({ id: `unlisted_${i}`, rarityWeight: 1.0, seriesYear: 2024, popularity: 10, onSummonList: false });
  }

  const pool = buildPool(chars);
  const N = 50_000;
  let counts: Map<string, number>;

  beforeAll(() => { counts = simulate(pool, N); });

  it("listed chars appear ~2x more", () => {
    const listed = groupTotal(counts, "listed_");
    const unlisted = groupTotal(counts, "unlisted_");
    const ratio = listed / unlisted;

    console.log(`  Listed/Unlisted: ${ratio.toFixed(2)}x (expected ~2.0x)`);
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
  });
});

// ─── Pool Simulation: Real-world scenario ───────────────

describe("pool sim: realistic summon pool", () => {
  // Simulate what a real summon pool looks like:
  // Mix of popular/obscure chars from different eras
  const chars: Omit<SimChar, "weight">[] = [
    // Popular modern (Gojo, Anya, Denji)
    { id: "gojo", rarityWeight: 0.02, seriesYear: 2020, popularity: 25000, onSummonList: false },
    { id: "anya", rarityWeight: 0.05, seriesYear: 2022, popularity: 15000, onSummonList: false },
    { id: "denji", rarityWeight: 0.05, seriesYear: 2022, popularity: 10000, onSummonList: false },
    // Popular classic (Goku, Naruto, Luffy)
    { id: "goku", rarityWeight: 0.02, seriesYear: 1989, popularity: 20000, onSummonList: false },
    { id: "naruto", rarityWeight: 0.05, seriesYear: 2002, popularity: 18000, onSummonList: false },
    { id: "luffy", rarityWeight: 0.05, seriesYear: 1999, popularity: 16000, onSummonList: false },
    // Obscure modern (random seasonal chars)
    ...Array.from({ length: 20 }, (_, i) => ({
      id: `obscure_new_${i}`, rarityWeight: 1.0, seriesYear: 2023, popularity: 10, onSummonList: false,
    })),
    // Obscure retro (random 1970s-1980s chars)
    ...Array.from({ length: 20 }, (_, i) => ({
      id: `obscure_old_${i}`, rarityWeight: 1.0, seriesYear: 1980, popularity: 5, onSummonList: false,
    })),
  ];

  const pool = buildPool(chars);
  const N = 100_000;
  let counts: Map<string, number>;

  beforeAll(() => { counts = simulate(pool, N); });

  it("most summons are obscure modern chars (filler feels modern)", () => {
    const obscureNewTotal = groupTotal(counts, "obscure_new_");
    const totalSelections = N;
    const pct = obscureNewTotal / totalSelections;

    console.log(`  Obscure modern: ${(pct * 100).toFixed(1)}% of all selections`);
    // With 20 chars × weight 4.0 each = 80 total weight, should dominate
    expect(pct).toBeGreaterThan(0.70);
  });

  it("obscure retro chars are rare (not flooding summons)", () => {
    const obscureOldTotal = groupTotal(counts, "obscure_old_");
    const pct = obscureOldTotal / N;
    console.log(`  Obscure retro: ${(pct * 100).toFixed(1)}% of all selections`);
    expect(pct).toBeLessThan(0.10);
  });

  it("Goku appears at comparable rate to Gojo (popular old NOT killed)", () => {
    const goku = counts.get("goku") ?? 0;
    const gojo = counts.get("gojo") ?? 0;

    const stronger = Math.max(gojo, goku);
    const weaker = Math.max(1, Math.min(gojo, goku));
    const ratio = stronger / weaker;
    console.log(`  Gojo: ${gojo}, Goku: ${goku}, stronger/weaker ratio: ${ratio.toFixed(2)}x`);
    // Either one can edge out in small Monte Carlo samples, but they should stay comparable.
    expect(ratio).toBeLessThan(2.5);
  });
});

// ─── DB Integration Smoke Tests ─────────────────────────

describe("performSummon: end-to-end (DB)", () => {
  beforeAll(async () => {
    await seedUser(TEST_SUMMONER, "test_runner");
    await seedGuild(TEST_GUILD);
  }, 10_000);

  afterAll(async () => {
    await cleanup();
    await closeDb();
  }, 30_000);

  it("returns 3 cards with valid structure", async () => {
    const result = await performSummon({
      discordUserId: TEST_SUMMONER,
      username: "test_runner",
      guildDiscordId: TEST_GUILD,
      skipCooldown: true,
      isActivitySpawn: true,
    });

    expect(result.cards).toHaveLength(3);
    for (const card of result.cards) {
      if (card.code === "__FUSION_TOKEN__") continue;
      expect(card.code).toHaveLength(6);
      expect(card.character.name).toBeTruthy();
      expect(card.quality).toMatch(/^(damaged|poor|good|excellent|pristine)$/);
    }
  });

  it("cards in same summon have unique codes and characters", async () => {
    const result = await performSummon({
      discordUserId: TEST_SUMMONER,
      username: "test_runner",
      guildDiscordId: TEST_GUILD,
      skipCooldown: true,
      isActivitySpawn: true,
    });

    const realCards = result.cards.filter((c) => c.code !== "__FUSION_TOKEN__");
    expect(new Set(realCards.map((c) => c.code)).size).toBe(realCards.length);
    expect(new Set(realCards.map((c) => c.characterId)).size).toBe(realCards.length);
  });

  it("cards are persisted in DB with no owner", async () => {
    const result = await performSummon({
      discordUserId: TEST_SUMMONER,
      username: "test_runner",
      guildDiscordId: TEST_GUILD,
      skipCooldown: true,
      isActivitySpawn: true,
    });

    for (const card of result.cards) {
      if (card.code === "__FUSION_TOKEN__") continue;
      const [dbCard] = await testDb
        .select()
        .from(cards)
        .where(eq(cards.code, card.code))
        .limit(1);

      expect(dbCard).toBeTruthy();
      expect(dbCard.ownerId).toBeNull();
    }
  });

  it("guarantees active wish target on the final summon in window", async () => {
    const wished = await seedCharacter({
      name: "GuaranteedWishTarget",
      series: "WishSeries",
      popularity: 1500,
      rarityWeight: 0.001,
    });

    const [u] = await testDb
      .select({ id: users.id })
      .from(users)
      .where(eq(users.discordId, TEST_SUMMONER))
      .limit(1);

    await testDb
      .update(users)
      .set({
        wishCharacterId: wished.characterId,
        wishSummonsRemaining: 1,
      })
      .where(eq(users.id, u.id));

    const result = await performSummon({
      discordUserId: TEST_SUMMONER,
      username: "test_runner",
      guildDiscordId: TEST_GUILD,
      skipCooldown: true,
      isActivitySpawn: true,
    });

    const realCards = result.cards.filter((c) => c.code !== "__FUSION_TOKEN__");
    expect(realCards.some((c) => c.characterId === wished.characterId)).toBe(true);

    const [after] = await testDb
      .select({
        wishCharacterId: users.wishCharacterId,
        wishSummonsRemaining: users.wishSummonsRemaining,
      })
      .from(users)
      .where(eq(users.discordId, TEST_SUMMONER))
      .limit(1);

    expect(after.wishCharacterId).toBeNull();
    expect(after.wishSummonsRemaining).toBe(0);
  });

  it("hard low-print pity forces a low print hit without changing character randomness model", async () => {
    const wished = await seedCharacter({
      name: "LowPrintPityTarget",
      series: "PitySeries",
      popularity: 1200,
      rarityWeight: 0.001,
    });

    const [u] = await testDb
      .select({ id: users.id })
      .from(users)
      .where(eq(users.discordId, TEST_SUMMONER))
      .limit(1);

    await testDb
      .update(users)
      .set({
        wishCharacterId: wished.characterId,
        wishSummonsRemaining: 1,
        lowPrintPityStreak: 100,
      })
      .where(eq(users.id, u.id));

    const result = await performSummon({
      discordUserId: TEST_SUMMONER,
      username: "test_runner",
      guildDiscordId: TEST_GUILD,
      skipCooldown: true,
      isActivitySpawn: true,
    });

    const wishedCard = result.cards.find(
      (c) => c.code !== "__FUSION_TOKEN__" && c.characterId === wished.characterId
    );
    expect(wishedCard).toBeTruthy();
    if (!wishedCard) return;
    // Low-print pity targets the early rarity band (<=25).
    expect(wishedCard.printNumber).toBeLessThanOrEqual(25);

    const [after] = await testDb
      .select({ lowPrintPityStreak: users.lowPrintPityStreak })
      .from(users)
      .where(eq(users.discordId, TEST_SUMMONER))
      .limit(1);
    expect(after.lowPrintPityStreak).toBe(0);
  });

  it("fusion token claims from fusion pile when entries exist", async () => {
    const [u] = await testDb
      .select({ id: users.id })
      .from(users)
      .where(eq(users.discordId, TEST_SUMMONER))
      .limit(1);

    const pileChar = await seedCharacter({
      name: "FusionPileTarget",
      series: "FusionPileSeries",
      popularity: 900,
      rarityWeight: 0.2,
    });

    await testDb.insert(fusionPileEntries).values({
      characterId: pileChar.characterId,
      editionId: pileChar.editionId,
      sourceUserId: u.id,
      source: "fusion",
      status: "available",
    });

    const summonId = `sim_fusion_${Date.now()}`;
    await redis.set(
      `summon:${summonId}`,
      JSON.stringify({
        cards: ["A1B2C3", "D4E5F6", "__FUSION_TOKEN__"],
        summonerId: TEST_SUMMONER,
        guildId: TEST_GUILD,
        grabbed: [false, false, false],
        grabbedBy: [null, null, null],
        mysteryIsFusionToken: true,
        fusionTokenAmount: 50,
        summonedAt: Date.now(),
      }),
      "EX",
      60
    );
    await redis.del(`cd:grab:${TEST_SUMMONER}`);

    const result = await grabCard(summonId, 2, TEST_SUMMONER, "test_runner");
    expect(result.success, result.success ? "" : result.reason).toBe(true);
    if (!result.success) return;
    expect(result.type).toBe("fusion_card");
    if (result.type !== "fusion_card") return;

    const [claimedCard] = await testDb
      .select({
        ownerId: cards.ownerId,
        characterId: cards.characterId,
        editionId: cards.editionId,
      })
      .from(cards)
      .where(eq(cards.code, result.cardCode))
      .limit(1);

    expect(claimedCard).toBeTruthy();
    expect(claimedCard.ownerId).toBe(u.id);
    expect(claimedCard.characterId).toBe(pileChar.characterId);
    expect(claimedCard.editionId).toBe(pileChar.editionId);
  });
});
