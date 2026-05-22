/**
 * Trade service integration tests.
 * Tests the full multi-trade lifecycle: create, add cards, remove, set gold, lock, execute.
 * Requires live DB + Redis.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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
import {
  createMultiTrade,
  getMultiTrade,
  addCardsToTrade,
  removeFromTrade,
  setTradeGold,
  lockTrade,
  executeMultiTrade,
  quickTrade,
} from "../src/services/trade.service.js";

const DISCORD_A = "test_trade_user_a_999";
const DISCORD_B = "test_trade_user_b_999";

let userAId: number;
let userBId: number;
let charId: number;
let editionId: number;

beforeAll(async () => {
  await seedGuild("test_guild");
  userAId = await seedUser(DISCORD_A, "alice");
  userBId = await seedUser(DISCORD_B, "bob");
  const char = await seedCharacter({ name: "TestChar", series: "TestSeries" });
  charId = char.characterId;
  editionId = char.editionId;
}, 15_000);

afterAll(async () => {
  await cleanup();
  await closeDb();
}, 30_000);

// ─── Session Lifecycle ───────────────────────────────────

describe("multi-trade: session lifecycle", () => {
  it("createMultiTrade returns a trade ID", async () => {
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);
    expect(tradeId).toMatch(/^mt_/);
  });

  it("getMultiTrade retrieves session with correct initial state", async () => {
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);
    const session = await getMultiTrade(tradeId);
    expect(session).not.toBeNull();
    expect(session!.initiatorId).toBe(DISCORD_A);
    expect(session!.receiverId).toBe(DISCORD_B);
    expect(session!.initiatorCards).toEqual([]);
    expect(session!.receiverCards).toEqual([]);
    expect(session!.initiatorGold).toBe(0);
    expect(session!.receiverGold).toBe(0);
    expect(session!.initiatorLocked).toBe(false);
    expect(session!.receiverLocked).toBe(false);
  });

  it("getMultiTrade returns null for non-existent trade", async () => {
    const session = await getMultiTrade("mt_nonexistent_abc123");
    expect(session).toBeNull();
  });
});

// ─── Adding Cards ────────────────────────────────────────

describe("multi-trade: adding cards", () => {
  it("adds a card with resolved info", async () => {
    const { code } = await seedCard({ characterId: charId, editionId, ownerId: userAId });
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);

    const result = await addCardsToTrade(tradeId, DISCORD_A, [code]);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.added).toHaveLength(1);
    expect(result.added[0].code).toBe(code);
    expect(result.added[0].charName).toBe("TestChar");
    expect(result.errors).toEqual([]);

    const session = await getMultiTrade(tradeId);
    expect(session!.initiatorCards).toHaveLength(1);
    expect(session!.initiatorCards[0].code).toBe(code);
  });

  it("adds multiple cards in a batch", async () => {
    const card1 = await seedCard({ characterId: charId, editionId, ownerId: userAId });
    const card2 = await seedCard({ characterId: charId, editionId, ownerId: userAId, printNumber: 2 });
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);

    const result = await addCardsToTrade(tradeId, DISCORD_A, [card1.code, card2.code]);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.added).toHaveLength(2);
  });

  it("rejects duplicate card in same side", async () => {
    const { code } = await seedCard({ characterId: charId, editionId, ownerId: userAId });
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);

    await addCardsToTrade(tradeId, DISCORD_A, [code]);
    const result = await addCardsToTrade(tradeId, DISCORD_A, [code]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.added).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("already in trade");
  });

  it("rejects card owned by other user", async () => {
    const { code } = await seedCard({ characterId: charId, editionId, ownerId: userBId });
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);

    const result = await addCardsToTrade(tradeId, DISCORD_A, [code]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.added).toHaveLength(0);
    expect(result.errors[0]).toContain("don't own");
  });

  it("rejects card in fusion pile", async () => {
    const { code } = await seedCard({ characterId: charId, editionId, ownerId: userAId, inFusionPile: true });
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);

    const result = await addCardsToTrade(tradeId, DISCORD_A, [code]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.added).toHaveLength(0);
    expect(result.errors[0]).toContain("fusion pile");
  });

  it("rejects non-participant", async () => {
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);
    const result = await addCardsToTrade(tradeId, "some_random_user", ["abc123"]);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("Not your trade");
  });

  it("fails on expired trade", async () => {
    const result = await addCardsToTrade("mt_expired_xyz", DISCORD_A, ["abc"]);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("expired");
  });
});

// ─── Removing Cards ──────────────────────────────────────

describe("multi-trade: removing cards", () => {
  it("removes a previously added card", async () => {
    const { code } = await seedCard({ characterId: charId, editionId, ownerId: userAId });
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);

    await addCardsToTrade(tradeId, DISCORD_A, [code]);
    const result = await removeFromTrade(tradeId, DISCORD_A, code);
    expect(result.success).toBe(true);

    const session = await getMultiTrade(tradeId);
    expect(session!.initiatorCards).toHaveLength(0);
  });

  it("fails to remove card not in trade", async () => {
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);
    const result = await removeFromTrade(tradeId, DISCORD_A, "not_here");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("not in your trade");
  });
});

// ─── Gold ────────────────────────────────────────────────

describe("multi-trade: gold", () => {
  it("sets gold amount", async () => {
    await setUserGold(userAId, 1000);
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);

    const result = await setTradeGold(tradeId, DISCORD_A, 500);
    expect(result.success).toBe(true);

    const session = await getMultiTrade(tradeId);
    expect(session!.initiatorGold).toBe(500);
  });

  it("rejects negative gold", async () => {
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);
    const result = await setTradeGold(tradeId, DISCORD_A, -100);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("negative");
  });

  it("rejects gold exceeding balance", async () => {
    await setUserGold(userAId, 100);
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);

    const result = await setTradeGold(tradeId, DISCORD_A, 999);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("Not enough gold");
  });

  it("allows setting gold to 0 (remove)", async () => {
    await setUserGold(userAId, 1000);
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);

    await setTradeGold(tradeId, DISCORD_A, 500);
    const result = await setTradeGold(tradeId, DISCORD_A, 0);
    expect(result.success).toBe(true);

    const session = await getMultiTrade(tradeId);
    expect(session!.initiatorGold).toBe(0);
  });
});

// ─── Locking ─────────────────────────────────────────────

describe("multi-trade: locking", () => {
  it("locks initiator side", async () => {
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);
    const result = await lockTrade(tradeId, DISCORD_A);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.bothLocked).toBe(false);

    const session = await getMultiTrade(tradeId);
    expect(session!.initiatorLocked).toBe(true);
    expect(session!.receiverLocked).toBe(false);
  });

  it("locks both sides", async () => {
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);
    await lockTrade(tradeId, DISCORD_A);
    const result = await lockTrade(tradeId, DISCORD_B);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.bothLocked).toBe(true);
  });

  it("rejects double lock", async () => {
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);
    await lockTrade(tradeId, DISCORD_A);
    const result = await lockTrade(tradeId, DISCORD_A);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("Already locked");
  });

  it("prevents adding cards after lock", async () => {
    const { code } = await seedCard({ characterId: charId, editionId, ownerId: userAId });
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);
    await lockTrade(tradeId, DISCORD_A);

    const result = await addCardsToTrade(tradeId, DISCORD_A, [code]);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("locked");
  });

  it("prevents setting gold after lock", async () => {
    await setUserGold(userAId, 1000);
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);
    await lockTrade(tradeId, DISCORD_A);

    const result = await setTradeGold(tradeId, DISCORD_A, 100);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("locked");
  });

  it("prevents removing cards after lock", async () => {
    const { code } = await seedCard({ characterId: charId, editionId, ownerId: userAId });
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);
    await addCardsToTrade(tradeId, DISCORD_A, [code]);
    await lockTrade(tradeId, DISCORD_A);

    const result = await removeFromTrade(tradeId, DISCORD_A, code);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("locked");
  });
});

// ─── Execution ───────────────────────────────────────────

describe("multi-trade: execution", () => {
  it("swaps cards between users", async () => {
    const cardA = await seedCard({ characterId: charId, editionId, ownerId: userAId, printNumber: 50 });
    const cardB = await seedCard({ characterId: charId, editionId, ownerId: userBId, printNumber: 51 });
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);

    await addCardsToTrade(tradeId, DISCORD_A, [cardA.code]);
    await addCardsToTrade(tradeId, DISCORD_B, [cardB.code]);
    await lockTrade(tradeId, DISCORD_A);
    await lockTrade(tradeId, DISCORD_B);

    const result = await executeMultiTrade(tradeId);
    expect(result.success).toBe(true);

    expect(await getCardOwner(cardA.code)).toBe(userBId);
    expect(await getCardOwner(cardB.code)).toBe(userAId);
  });

  it("swaps gold between users", async () => {
    await setUserGold(userAId, 1000);
    await setUserGold(userBId, 500);
    const cardA = await seedCard({ characterId: charId, editionId, ownerId: userAId, printNumber: 60 });

    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);
    await addCardsToTrade(tradeId, DISCORD_A, [cardA.code]);
    await setTradeGold(tradeId, DISCORD_B, 200);
    await lockTrade(tradeId, DISCORD_A);
    await lockTrade(tradeId, DISCORD_B);

    const result = await executeMultiTrade(tradeId);
    expect(result.success).toBe(true);

    // A gave card, B gave 200 gold -> A gets 200 gold, B gets card
    expect(await getCardOwner(cardA.code)).toBe(userBId);
    expect(await getUserGold(userAId)).toBe(1200);
    expect(await getUserGold(userBId)).toBe(300);
  });

  it("fails when neither side has items", async () => {
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);
    await lockTrade(tradeId, DISCORD_A);
    await lockTrade(tradeId, DISCORD_B);

    const result = await executeMultiTrade(tradeId);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("Nothing to trade");
  });

  it("fails when only one side is locked", async () => {
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);
    await lockTrade(tradeId, DISCORD_A);

    const result = await executeMultiTrade(tradeId);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("Both sides must lock");
  });

  it("deletes session from Redis after successful execution", async () => {
    const cardA = await seedCard({ characterId: charId, editionId, ownerId: userAId, printNumber: 70 });
    const tradeId = await createMultiTrade(DISCORD_A, DISCORD_B);
    await addCardsToTrade(tradeId, DISCORD_A, [cardA.code]);
    await lockTrade(tradeId, DISCORD_A);
    await lockTrade(tradeId, DISCORD_B);
    await executeMultiTrade(tradeId);

    const session = await getMultiTrade(tradeId);
    expect(session).toBeNull();
  });
});

// ─── Quick Trade ─────────────────────────────────────────

describe("quickTrade", () => {
  it("swaps two cards", async () => {
    const cardA = await seedCard({ characterId: charId, editionId, ownerId: userAId, printNumber: 80 });
    const cardB = await seedCard({ characterId: charId, editionId, ownerId: userBId, printNumber: 81 });

    const result = await quickTrade(DISCORD_A, "alice", DISCORD_B, "bob", cardA.code, cardB.code);
    expect(result.success).toBe(true);

    expect(await getCardOwner(cardA.code)).toBe(userBId);
    expect(await getCardOwner(cardB.code)).toBe(userAId);
  });

  it("rejects self-trade", async () => {
    const result = await quickTrade(DISCORD_A, "alice", DISCORD_A, "alice", "abc", "def");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("yourself");
  });

  it("rejects trading card you don't own", async () => {
    const cardB = await seedCard({ characterId: charId, editionId, ownerId: userBId, printNumber: 82 });
    const result = await quickTrade(DISCORD_A, "alice", DISCORD_B, "bob", "nonexistent", cardB.code);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("don't own");
  });
});
