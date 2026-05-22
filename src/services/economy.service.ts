import { db } from "../db/index.js";
import { users, cards } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { getCooldown, setCooldown } from "../cache/cooldowns.js";
import { ensureUser } from "./summon.service.js";
import { logAudit } from "./audit.service.js";

/** Collect daily gold reward (1-100 gold). Returns amount earned. */
export async function claimDaily(
  discordId: string,
  username: string
): Promise<{ success: true; amount: number; streak?: number; buffApplied?: string } | { success: false; remaining: number }> {
  const remaining = await getCooldown(discordId, "daily");
  if (remaining > 0) {
    return { success: false, remaining };
  }

  const userId = await ensureUser(discordId, username);
  let amount = Math.floor(Math.random() * 100) + 1;

  // Fortune's Favor buff: double daily reward (consumed on use)
  const { getBuffEffect, consumeBuff } = await import("./buff.service.js");
  const dailyMult = await getBuffEffect(discordId, "dailyMult");
  if (dailyMult) {
    amount = Math.ceil(amount * dailyMult);
    await consumeBuff(discordId, "daily_double");
  }

  await db
    .update(users)
    .set({ gold: sql`${users.gold} + ${amount}` })
    .where(eq(users.id, userId));

  await setCooldown(discordId, "daily");

  return { success: true, amount, buffApplied: dailyMult ? "Fortune's Favor" : undefined };
}

/** Get a user's balance. */
export async function getBalance(discordId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, discordId),
    columns: { gold: true, opals: true, roses: true, cinders: true, shards: true },
  });
  if (!user) {
    return { gold: 0, petals: 0, opals: 0, roses: 0, cinders: 0, shards: 0 };
  }
  // Petals are currently stored in the legacy `opals` column.
  return {
    gold: user.gold,
    petals: user.opals,
    opals: user.opals,
    roses: user.roses,
    cinders: user.cinders,
    shards: user.shards,
  };
}

/** Give a card to another user. */
export async function giveCard(
  fromDiscordId: string,
  fromUsername: string,
  toDiscordId: string,
  toUsername: string,
  cardCode: string
): Promise<{ success: true } | { success: false; reason: string }> {
  const fromId = await ensureUser(fromDiscordId, fromUsername);
  const toId = await ensureUser(toDiscordId, toUsername);

  if (fromId === toId) {
    return { success: false, reason: "You can't give a card to yourself." };
  }

  // Verify ownership
  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, cardCode), eq(cards.ownerId, fromId)),
    columns: { id: true, inFusionPile: true },
  });

  if (!card) {
    return { success: false, reason: `You don't own card \`${cardCode}\`.` };
  }
  if (card.inFusionPile) {
    return { success: false, reason: "That card is in your fusion pile." };
  }

  // Transfer
  await db
    .update(cards)
    .set({ ownerId: toId, updatedAt: new Date() })
    .where(eq(cards.id, card.id));

  // Stats
  await db
    .update(users)
    .set({ totalGifts: sql`${users.totalGifts} + 1` })
    .where(eq(users.id, fromId));

  await logAudit(fromId, "give_card", { cardCode, toUserId: toId });

  return { success: true };
}

/** Give gold to another user. */
export async function giveGold(
  fromDiscordId: string,
  fromUsername: string,
  toDiscordId: string,
  toUsername: string,
  amount: number
): Promise<{ success: true } | { success: false; reason: string }> {
  if (amount <= 0) return { success: false, reason: "Amount must be positive." };

  const fromId = await ensureUser(fromDiscordId, fromUsername);
  const toId = await ensureUser(toDiscordId, toUsername);

  if (fromId === toId) return { success: false, reason: "You can't give gold to yourself." };

  const sender = await db.query.users.findFirst({
    where: eq(users.id, fromId),
    columns: { gold: true },
  });

  if (!sender || sender.gold < amount) {
    return { success: false, reason: "You don't have enough gold." };
  }

  await db.update(users).set({ gold: sql`${users.gold} - ${amount}` }).where(eq(users.id, fromId));
  await db.update(users).set({ gold: sql`${users.gold} + ${amount}` }).where(eq(users.id, toId));

  await logAudit(fromId, "give_gold", { amount, toUserId: toId });

  return { success: true };
}

// ─── Slot Upgrades ──────────────────────────────────────

const SLOT_COSTS = [500, 1000, 2000, 4000, 8000, 16000, 32000];

function slotUpgradeCost(currentSlots: number, baseSlots: number): number | null {
  const upgradesDone = currentSlots - baseSlots;
  if (upgradesDone >= SLOT_COSTS.length) return null;
  return SLOT_COSTS[upgradesDone];
}

export async function upgradeSummonSlots(
  discordId: string,
  username: string
): Promise<{ success: true; newSlots: number; cost: number } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, username);
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { gold: true, summonListSlots: true },
  });
  if (!user) return { success: false, reason: "User not found." };

  const cost = slotUpgradeCost(user.summonListSlots, 5);
  if (cost === null) return { success: false, reason: "Summon list is at max capacity (12 slots)." };
  if (user.gold < cost) return { success: false, reason: `Need **${cost.toLocaleString()} Gold**. You have ${user.gold.toLocaleString()}.` };

  await db.update(users).set({
    gold: sql`${users.gold} - ${cost}`,
    summonListSlots: sql`${users.summonListSlots} + 1`,
  }).where(eq(users.id, userId));

  return { success: true, newSlots: user.summonListSlots + 1, cost };
}

export async function upgradeLikeSlots(
  discordId: string,
  username: string
): Promise<{ success: true; newSlots: number; cost: number } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, username);
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { gold: true, likeListSlots: true },
  });
  if (!user) return { success: false, reason: "User not found." };

  const cost = slotUpgradeCost(user.likeListSlots, 10);
  if (cost === null) return { success: false, reason: "Like list is at max capacity (17 slots)." };
  if (user.gold < cost) return { success: false, reason: `Need **${cost.toLocaleString()} Gold**. You have ${user.gold.toLocaleString()}.` };

  await db.update(users).set({
    gold: sql`${users.gold} - ${cost}`,
    likeListSlots: sql`${users.likeListSlots} + 1`,
  }).where(eq(users.id, userId));

  return { success: true, newSlots: user.likeListSlots + 1, cost };
}

export function getSlotUpgradeInfo(currentSlots: number, baseSlots: number) {
  const cost = slotUpgradeCost(currentSlots, baseSlots);
  return { currentSlots, maxSlots: baseSlots + SLOT_COSTS.length, cost, atMax: cost === null };
}

/** Upgrade a card's quality by spending cinders. Respects Forge Fire buff (25% cost reduction). */
export async function upgradeCard(
  discordId: string,
  username: string,
  cardCode: string
): Promise<{ success: true; newQuality: string; cost: number; buffApplied?: string } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, username);

  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, cardCode), eq(cards.ownerId, userId)),
    columns: { id: true, quality: true },
  });

  if (!card) return { success: false, reason: `You don't own card \`${cardCode}\`.` };

  const upgradePath: Record<string, { next: string; cost: number }> = {
    damaged: { next: "poor", cost: 10 },
    poor: { next: "good", cost: 25 },
    good: { next: "excellent", cost: 75 },
    excellent: { next: "pristine", cost: 200 },
  };

  const upgrade = upgradePath[card.quality];
  if (!upgrade) return { success: false, reason: "Card is already pristine quality!" };

  // Check for Forge Fire buff (25% cost reduction)
  const { getBuffEffect } = await import("./buff.service.js");
  const costMult = await getBuffEffect(discordId, "upgradeCostMult");
  const finalCost = costMult ? Math.ceil(upgrade.cost * costMult) : upgrade.cost;
  const buffApplied = costMult ? "Forge Fire" : undefined;

  // Check for Upgrade Potion (pays remaining cost)
  const { getPotionCount, usePotion } = await import("./potion.service.js");
  const hasUpgradePotion = await getPotionCount(discordId, "upgrade_potion");

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { cinders: true },
  });

  if (!user || user.cinders < finalCost) {
    if (hasUpgradePotion > 0) {
      await usePotion(discordId, "upgrade_potion");
      const actualCost = Math.min(user?.cinders ?? 0, finalCost);
      if (actualCost > 0) {
        await db.update(users).set({ cinders: sql`${users.cinders} - ${actualCost}` }).where(eq(users.id, userId));
      }
      await db.update(cards).set({ quality: upgrade.next as any, updatedAt: new Date() }).where(eq(cards.id, card.id));
      return { success: true, newQuality: upgrade.next, cost: actualCost, buffApplied: "Upgrade Potion" };
    }
    return { success: false, reason: `Need **${finalCost} Cinders** to upgrade. You have ${user?.cinders ?? 0}.${buffApplied ? ` (${buffApplied} applied)` : ""}` };
  }

  await db.update(users).set({ cinders: sql`${users.cinders} - ${finalCost}` }).where(eq(users.id, userId));
  await db.update(cards).set({ quality: upgrade.next as any, updatedAt: new Date() }).where(eq(cards.id, card.id));

  return { success: true, newQuality: upgrade.next, cost: finalCost, buffApplied };
}
