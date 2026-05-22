import { db } from "../db/index.js";
import { users, cards } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { ensureUser } from "./summon.service.js";
import { enqueueFusionPileEntries } from "./fusion-pile.service.js";
import { redis } from "../cache/index.js";

const FUSE_COST = 3; // cards needed to fuse
const FUSION_LOCK_TTL_SEC = 15;
const FUSION_YIELD_BY_QUALITY: Record<
  string,
  { gold: number; cinders: number }
> = {
  damaged: { gold: 4, cinders: 2 },
  poor: { gold: 8, cinders: 3 },
  good: { gold: 12, cinders: 5 },
  excellent: { gold: 20, cinders: 8 },
  pristine: { gold: 35, cinders: 12 },
};

function fusionYieldForQuality(quality: string): { gold: number; cinders: number } {
  return FUSION_YIELD_BY_QUALITY[quality] ?? FUSION_YIELD_BY_QUALITY.good;
}

function pickPileSeedsFromFusedCards(
  fusedCards: Array<{ characterId: number; editionId: number; id: number }>,
  setSize = 3
) {
  const seeds: Array<{ characterId: number; editionId: number; sourceCardId: number }> = [];
  for (let i = 0; i < fusedCards.length; i += setSize) {
    const chunk = fusedCards.slice(i, i + setSize);
    if (chunk.length === 0) continue;
    const picked = chunk[Math.floor(Math.random() * chunk.length)];
    seeds.push({
      characterId: picked.characterId,
      editionId: picked.editionId,
      sourceCardId: picked.id,
    });
  }
  return seeds;
}

async function acquireFusionLock(discordId: string): Promise<{ key: string; token: string } | null> {
  const key = `fuse:lock:${discordId}`;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const locked = await redis.set(key, token, "EX", FUSION_LOCK_TTL_SEC, "NX");
  if (!locked) return null;
  return { key, token };
}

async function releaseFusionLock(key: string, token: string): Promise<void> {
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    key,
    token
  );
}

/** Get a user's fusion board (cards marked as in_fusion_pile). */
export async function getFusionBoard(discordId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, discordId),
    columns: { id: true },
  });
  if (!user) return [];

  return db.query.cards.findMany({
    where: and(eq(cards.ownerId, user.id), eq(cards.inFusionPile, true)),
    columns: { id: true, code: true, characterId: true, quality: true },
  });
}

/** Add cards to the fusion board. */
export async function fuseAdd(
  discordId: string,
  username: string,
  cardCodes: string[]
): Promise<{ success: true; added: number } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, username);

  let added = 0;
  for (const code of cardCodes) {
    const card = await db.query.cards.findFirst({
      where: and(
        eq(cards.code, code),
        eq(cards.ownerId, userId),
        eq(cards.inFusionPile, false)
      ),
      columns: { id: true },
    });

    if (!card) continue;

    await db
      .update(cards)
      .set({ inFusionPile: true, updatedAt: new Date() })
      .where(eq(cards.id, card.id));
    added++;
  }

  if (added === 0) {
    return { success: false, reason: "No valid cards to add. Check you own them and they're not already on the board." };
  }

  return { success: true, added };
}

/** Remove a card from the fusion board. */
export async function fuseRemove(
  discordId: string,
  username: string,
  cardCode: string
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, username);

  const card = await db.query.cards.findFirst({
    where: and(
      eq(cards.code, cardCode),
      eq(cards.ownerId, userId),
      eq(cards.inFusionPile, true)
    ),
    columns: { id: true },
  });

  if (!card) return { success: false, reason: "Card not found on your fusion board." };

  await db.update(cards).set({ inFusionPile: false, updatedAt: new Date() }).where(eq(cards.id, card.id));
  return { success: true };
}

/** Fuse: consume 3 cards from the board → gold + cinders. */
export async function fuse(
  discordId: string,
  username: string
): Promise<{ success: true; fused: number; goldEarned: number; cindersEarned: number; pileAdded: number; remaining: number } | { success: false; reason: string }> {
  const lock = await acquireFusionLock(discordId);
  if (!lock) {
    return { success: false, reason: "Fusion already in progress. Try again in a moment." };
  }
  try {
  const userId = await ensureUser(discordId, username);

  const board = await db.query.cards.findMany({
    where: and(eq(cards.ownerId, userId), eq(cards.inFusionPile, true)),
    columns: { id: true, code: true, quality: true, characterId: true, editionId: true },
  });

  if (board.length < FUSE_COST) {
    return { success: false, reason: `Need at least **${FUSE_COST}** cards on the board. You have ${board.length}.` };
  }

  // Take first 3
  const toFuse = board.slice(0, FUSE_COST);
  const baseGold = toFuse.reduce(
    (sum, card) => sum + fusionYieldForQuality(card.quality).gold,
    0
  );
  const baseCinders = toFuse.reduce(
    (sum, card) => sum + fusionYieldForQuality(card.quality).cinders,
    0
  );

  const pileSeeds = pickPileSeedsFromFusedCards(toFuse, FUSE_COST);
  const pileAdded = await enqueueFusionPileEntries(userId, pileSeeds, "fusion");

  // Delete fused cards
  for (const card of toFuse) {
    await db.delete(cards).where(eq(cards.id, card.id));
  }

  // Alchemist's Touch buff: +50% cinders
  const { getBuffEffect } = await import("./buff.service.js");
  const cinderMult = await getBuffEffect(discordId, "fusionCinderMult") ?? 1;
  const finalCinders = Math.ceil(baseCinders * cinderMult);

  await db
    .update(users)
    .set({
      gold: sql`${users.gold} + ${baseGold}`,
      cinders: sql`${users.cinders} + ${finalCinders}`,
      totalFusions: sql`${users.totalFusions} + 1`,
    })
    .where(eq(users.id, userId));

  return {
    success: true,
    fused: FUSE_COST,
    goldEarned: baseGold,
    cindersEarned: finalCinders,
    pileAdded,
    remaining: board.length - FUSE_COST,
  };
  } finally {
    await releaseFusionLock(lock.key, lock.token);
  }
}

/** Fast fuse: fuse as many sets of 3 as possible from the board. */
export async function fastFuse(
  discordId: string,
  username: string
): Promise<{ success: true; totalFused: number; goldEarned: number; cindersEarned: number; pileAdded: number; remaining: number } | { success: false; reason: string }> {
  const lock = await acquireFusionLock(discordId);
  if (!lock) {
    return { success: false, reason: "Fusion already in progress. Try again in a moment." };
  }
  try {
  const userId = await ensureUser(discordId, username);

  const board = await db.query.cards.findMany({
    where: and(eq(cards.ownerId, userId), eq(cards.inFusionPile, true)),
    columns: { id: true, quality: true, characterId: true, editionId: true },
  });

  const sets = Math.floor(board.length / FUSE_COST);
  if (sets === 0) {
    return { success: false, reason: `Need at least **${FUSE_COST}** cards on the board. You have ${board.length}.` };
  }

  const toFuse = board.slice(0, sets * FUSE_COST);
  const pileSeeds = pickPileSeedsFromFusedCards(toFuse, FUSE_COST);
  const pileAdded = await enqueueFusionPileEntries(userId, pileSeeds, "fusion");

  for (const card of toFuse) {
    await db.delete(cards).where(eq(cards.id, card.id));
  }

  const { getBuffEffect } = await import("./buff.service.js");
  const cinderMult = await getBuffEffect(discordId, "fusionCinderMult") ?? 1;

  const totalGold = toFuse.reduce(
    (sum, card) => sum + fusionYieldForQuality(card.quality).gold,
    0
  );
  const baseCinders = toFuse.reduce(
    (sum, card) => sum + fusionYieldForQuality(card.quality).cinders,
    0
  );
  const totalCinders = Math.ceil(baseCinders * cinderMult);

  await db
    .update(users)
    .set({
      gold: sql`${users.gold} + ${totalGold}`,
      cinders: sql`${users.cinders} + ${totalCinders}`,
      totalFusions: sql`${users.totalFusions} + ${sets}`,
    })
    .where(eq(users.id, userId));

  return {
    success: true,
    totalFused: toFuse.length,
    goldEarned: totalGold,
    cindersEarned: totalCinders,
    pileAdded,
    remaining: board.length - toFuse.length,
  };
  } finally {
    await releaseFusionLock(lock.key, lock.token);
  }
}
