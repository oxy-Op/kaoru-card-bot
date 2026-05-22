/**
 * Economy service integration tests.
 * Tests giveCard, giveGold, upgradeCard against the real DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  testDb,
  seedCharacter,
  seedUser,
  seedGuild,
  seedCard,
  setUserGold,
  getUserGold,
  getCardOwner,
  cleanup,
  closeDb,
} from "./setup.js";
import { giveCard, giveGold, upgradeCard, getBalance } from "../src/services/economy.service.js";
import { users } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { LEVEL_REQUIREMENTS } from "../src/services/level.service.js";

const DISCORD_A = "test_econ_user_a_999";
const DISCORD_B = "test_econ_user_b_999";

let userAId: number;
let userBId: number;
let charId: number;
let editionId: number;

beforeAll(async () => {
  await seedGuild("test_guild");
  userAId = await seedUser(DISCORD_A, "econAlice");
  userBId = await seedUser(DISCORD_B, "econBob");
  const char = await seedCharacter({ name: "EconChar", series: "EconSeries" });
  charId = char.characterId;
  editionId = char.editionId;
}, 15_000);

afterAll(async () => {
  await cleanup();
  await closeDb();
}, 30_000);

// ─── giveCard ────────────────────────────────────────────

describe("giveCard", () => {
  it("transfers card ownership", async () => {
    const { code } = await seedCard({ characterId: charId, editionId, ownerId: userAId });

    const result = await giveCard(DISCORD_A, "econAlice", DISCORD_B, "econBob", code);
    expect(result.success).toBe(true);
    expect(await getCardOwner(code)).toBe(userBId);
  });

  it("rejects giving to yourself", async () => {
    const { code } = await seedCard({ characterId: charId, editionId, ownerId: userAId });
    const result = await giveCard(DISCORD_A, "econAlice", DISCORD_A, "econAlice", code);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("yourself");
  });

  it("rejects giving card you don't own", async () => {
    const result = await giveCard(DISCORD_A, "econAlice", DISCORD_B, "econBob", "nonexistent_code");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("don't own");
  });

  it("rejects giving card in fusion pile", async () => {
    const { code } = await seedCard({ characterId: charId, editionId, ownerId: userAId, inFusionPile: true });
    const result = await giveCard(DISCORD_A, "econAlice", DISCORD_B, "econBob", code);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("fusion pile");
  });
});

// ─── giveGold ────────────────────────────────────────────

describe("giveGold", () => {
  it("transfers gold between users", async () => {
    await setUserGold(userAId, 500);
    await setUserGold(userBId, 100);

    const result = await giveGold(DISCORD_A, "econAlice", DISCORD_B, "econBob", 200);
    expect(result.success).toBe(true);

    expect(await getUserGold(userAId)).toBe(300);
    expect(await getUserGold(userBId)).toBe(300);
  });

  it("rejects giving 0 or negative gold", async () => {
    const result0 = await giveGold(DISCORD_A, "econAlice", DISCORD_B, "econBob", 0);
    expect(result0.success).toBe(false);

    const resultNeg = await giveGold(DISCORD_A, "econAlice", DISCORD_B, "econBob", -50);
    expect(resultNeg.success).toBe(false);
  });

  it("rejects giving more gold than you have", async () => {
    await setUserGold(userAId, 50);
    const result = await giveGold(DISCORD_A, "econAlice", DISCORD_B, "econBob", 100);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("enough gold");
  });

  it("rejects giving gold to yourself", async () => {
    await setUserGold(userAId, 500);
    const result = await giveGold(DISCORD_A, "econAlice", DISCORD_A, "econAlice", 100);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("yourself");
  });
});

// ─── upgradeCard ─────────────────────────────────────────

describe("upgradeCard", () => {
  it("upgrades damaged -> poor", async () => {
    const { code } = await seedCard({
      characterId: charId, editionId, ownerId: userAId, quality: "damaged",
    });
    await testDb.update(users).set({ cinders: 100 }).where(eq(users.id, userAId));

    const result = await upgradeCard(DISCORD_A, "econAlice", code);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.newQuality).toBe("poor");
    expect(result.cost).toBe(10);
  });

  it("upgrades good -> excellent for 75 cinders", async () => {
    const { code } = await seedCard({
      characterId: charId, editionId, ownerId: userAId, quality: "good",
    });
    await testDb.update(users).set({ cinders: 200 }).where(eq(users.id, userAId));

    const result = await upgradeCard(DISCORD_A, "econAlice", code);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.newQuality).toBe("excellent");
    expect(result.cost).toBe(75);
  });

  it("rejects upgrading pristine card", async () => {
    const { code } = await seedCard({
      characterId: charId, editionId, ownerId: userAId, quality: "pristine",
    });

    const result = await upgradeCard(DISCORD_A, "econAlice", code);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("already pristine");
  });

  it("rejects upgrade with insufficient cinders", async () => {
    const { code } = await seedCard({
      characterId: charId, editionId, ownerId: userAId, quality: "excellent",
    });
    await testDb.update(users).set({ cinders: 10 }).where(eq(users.id, userAId));

    const result = await upgradeCard(DISCORD_A, "econAlice", code);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("Cinders");
  });

  it("rejects upgrading card you don't own", async () => {
    const result = await upgradeCard(DISCORD_A, "econAlice", "nonexistent");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("don't own");
  });
});

// ─── getBalance ──────────────────────────────────────────

describe("getBalance", () => {
  it("returns zero for unknown user", async () => {
    const bal = await getBalance("unknown_discord_id_999");
    expect(bal.gold).toBe(0);
    expect(bal.petals).toBe(0);
    expect(bal.opals).toBe(0);
    expect(bal.roses).toBe(0);
  });

  it("returns correct gold for known user", async () => {
    await setUserGold(userAId, 777);
    const bal = await getBalance(DISCORD_A);
    expect(bal.gold).toBe(777);
  });

  it("maps legacy opals to petals alias", async () => {
    await testDb.update(users).set({ opals: 42 }).where(eq(users.id, userAId));
    const bal = await getBalance(DISCORD_A);
    expect(bal.opals).toBe(42);
    expect(bal.petals).toBe(42);
  });

  it("returns roses balance for known user", async () => {
    await testDb.update(users).set({ roses: 9 }).where(eq(users.id, userAId));
    const bal = await getBalance(DISCORD_A);
    expect(bal.roses).toBe(9);
  });
});

describe("economy gating policy", () => {
  it("keeps transfer actions ungated by level", () => {
    expect(LEVEL_REQUIREMENTS.give).toBe(1);
    expect(LEVEL_REQUIREMENTS.trade).toBe(1);
    expect(LEVEL_REQUIREMENTS.multitrade).toBe(1);
  });

  it("gates card hunter at level 20", () => {
    expect(LEVEL_REQUIREMENTS.cardhunter).toBe(20);
  });
});
