import { redis } from "../cache/index.js";
import { db } from "../db/index.js";
import { users, cards } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { ensureUser } from "./summon.service.js";

export interface PotionDef {
  id: string;
  name: string;
  description: string;
  goldCost: number;
  maxStack: number;
}

export const POTIONS: PotionDef[] = [
  {
    id: "upgrade_potion",
    name: "Upgrade Potion",
    description: "Guarantees next card upgrade succeeds (even if insufficient cinders — pays the difference)",
    goldCost: 3000,
    maxStack: 5,
  },
  {
    id: "xp_potion",
    name: "XP Elixir",
    description: "Grants 500 XP instantly",
    goldCost: 1500,
    maxStack: 10,
  },
  {
    id: "quality_reroll",
    name: "Quality Reroll",
    description: "Randomly re-rolls a card's quality (could go up or down)",
    goldCost: 2000,
    maxStack: 5,
  },
  {
    id: "print_reveal",
    name: "Oracle's Eye",
    description: "Reveals the hidden card in your next summon before grabbing",
    goldCost: 1000,
    maxStack: 3,
  },
  {
    id: "cooldown_reset",
    name: "Time Warp",
    description: "Resets all your cooldowns instantly",
    goldCost: 2500,
    maxStack: 3,
  },
];

const POTION_KEY = (discordId: string) => `potions:${discordId}`;

export async function buyPotion(
  discordId: string,
  username: string,
  potionId: string,
  qty: number = 1
): Promise<{ success: true; potion: PotionDef; newCount: number; totalCost: number } | { success: false; reason: string }> {
  const def = POTIONS.find((p) => p.id === potionId);
  if (!def) return { success: false, reason: "Unknown potion." };
  if (qty < 1 || qty > 10) return { success: false, reason: "Quantity must be 1-10." };

  const current = parseInt(await redis.hget(POTION_KEY(discordId), potionId) ?? "0");
  if (current + qty > def.maxStack) {
    return { success: false, reason: `Max stack is **${def.maxStack}**. You have ${current}.` };
  }

  const totalCost = def.goldCost * qty;
  const userId = await ensureUser(discordId, username);
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { gold: true },
  });

  if (!user || user.gold < totalCost) {
    return { success: false, reason: `Need **${totalCost.toLocaleString()} Gold**. You have ${user?.gold.toLocaleString() ?? 0}.` };
  }

  await db.update(users).set({ gold: sql`${users.gold} - ${totalCost}` }).where(eq(users.id, userId));
  const newCount = await redis.hincrby(POTION_KEY(discordId), potionId, qty);

  return { success: true, potion: def, newCount, totalCost };
}

export async function usePotion(
  discordId: string,
  potionId: string
): Promise<boolean> {
  const current = parseInt(await redis.hget(POTION_KEY(discordId), potionId) ?? "0");
  if (current <= 0) return false;
  await redis.hincrby(POTION_KEY(discordId), potionId, -1);
  return true;
}

export async function getPotionCount(discordId: string, potionId: string): Promise<number> {
  return parseInt(await redis.hget(POTION_KEY(discordId), potionId) ?? "0");
}

export async function getAllPotions(discordId: string): Promise<{ potion: PotionDef; count: number }[]> {
  const all = await redis.hgetall(POTION_KEY(discordId));
  const result: { potion: PotionDef; count: number }[] = [];

  for (const def of POTIONS) {
    const count = parseInt(all[def.id] ?? "0");
    if (count > 0) result.push({ potion: def, count });
  }

  return result;
}

const QUALITIES = ["damaged", "poor", "good", "excellent", "pristine"];

export async function useXpPotion(discordId: string, username: string): Promise<{ success: true; xpGained: number } | { success: false; reason: string }> {
  const used = await usePotion(discordId, "xp_potion");
  if (!used) return { success: false, reason: "You don't have any XP Elixirs." };

  const userId = await ensureUser(discordId, username);
  await db.update(users).set({ xp: sql`${users.xp} + 500` }).where(eq(users.id, userId));
  return { success: true, xpGained: 500 };
}

export async function useQualityReroll(
  discordId: string,
  username: string,
  cardCode: string
): Promise<{ success: true; oldQuality: string; newQuality: string } | { success: false; reason: string }> {
  const used = await usePotion(discordId, "quality_reroll");
  if (!used) return { success: false, reason: "You don't have any Quality Rerolls." };

  const userId = await ensureUser(discordId, username);
  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, cardCode), eq(cards.ownerId, userId)),
    columns: { id: true, quality: true },
  });

  if (!card) {
    await redis.hincrby(POTION_KEY(discordId), "quality_reroll", 1);
    return { success: false, reason: `You don't own card \`${cardCode}\`.` };
  }

  const oldQuality = card.quality;
  // Weighted random — biased slightly toward the center
  const weights = [10, 20, 40, 20, 10];
  let total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  let newQuality = QUALITIES[2];
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) { newQuality = QUALITIES[i]; break; }
  }

  await db.update(cards).set({ quality: newQuality as any, updatedAt: new Date() }).where(eq(cards.id, card.id));
  return { success: true, oldQuality, newQuality };
}

export async function useCooldownReset(discordId: string): Promise<{ success: true } | { success: false; reason: string }> {
  const used = await usePotion(discordId, "cooldown_reset");
  if (!used) return { success: false, reason: "You don't have any Time Warps." };

  const keys = ["cooldown:summon", "cooldown:grab", "cooldown:daily", "cooldown:vote", "cooldown:minigame"]
    .map((k) => `${k}:${discordId}`);
  await Promise.all(keys.map((k) => redis.del(k)));

  return { success: true };
}
