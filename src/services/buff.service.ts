import { redis } from "../cache/index.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { ensureUser } from "./summon.service.js";

export interface BuffDef {
  id: string;
  name: string;
  description: string;
  durationSec: number;
  goldCost: number;
  effect: Record<string, number>;
}

export const BUFFS: BuffDef[] = [
  {
    id: "upgrade_boost",
    name: "Forge Fire",
    description: "Reduces cinder cost for upgrades by 25%",
    durationSec: 3600,
    goldCost: 1000,
    effect: { upgradeCostMult: 0.75 },
  },
  {
    id: "grab_speed",
    name: "Quick Hands",
    description: "Reduces grab cooldown by 30%",
    durationSec: 1800,
    goldCost: 800,
    effect: { grabCdMult: 0.7 },
  },
  {
    id: "fusion_bonus",
    name: "Alchemist's Touch",
    description: "+50% cinders from fusion",
    durationSec: 3600,
    goldCost: 1200,
    effect: { fusionCinderMult: 1.5 },
  },
  {
    id: "xp_boost",
    name: "Scholar's Insight",
    description: "+50% XP from all sources",
    durationSec: 3600,
    goldCost: 600,
    effect: { xpMult: 1.5 },
  },
  {
    id: "daily_double",
    name: "Fortune's Favor",
    description: "Next daily reward is doubled",
    durationSec: 86400,
    goldCost: 500,
    effect: { dailyMult: 2 },
  },
  {
    id: "summon_luck",
    name: "Star Alignment",
    description: "Slightly better print numbers when summoning",
    durationSec: 1800,
    goldCost: 2000,
    effect: { printLuckBoost: 0.15 },
  },
];

const BUFF_KEY = (discordId: string) => `buffs:${discordId}`;

export async function buyBuff(
  discordId: string,
  username: string,
  buffId: string
): Promise<{ success: true; buff: BuffDef; expiresAt: number } | { success: false; reason: string }> {
  const def = BUFFS.find((b) => b.id === buffId);
  if (!def) return { success: false, reason: "Unknown buff." };

  const existing = await redis.hget(BUFF_KEY(discordId), buffId);
  if (existing && parseInt(existing) > Date.now()) {
    const left = Math.ceil((parseInt(existing) - Date.now()) / 1000);
    const mins = Math.ceil(left / 60);
    return { success: false, reason: `**${def.name}** is already active (${mins}m remaining).` };
  }

  const userId = await ensureUser(discordId, username);
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { gold: true },
  });

  if (!user || user.gold < def.goldCost) {
    return { success: false, reason: `Need **${def.goldCost.toLocaleString()} Gold**. You have ${user?.gold.toLocaleString() ?? 0}.` };
  }

  await db.update(users).set({ gold: sql`${users.gold} - ${def.goldCost}` }).where(eq(users.id, userId));

  const expiresAt = Date.now() + def.durationSec * 1000;
  await redis.hset(BUFF_KEY(discordId), buffId, expiresAt.toString());
  await redis.expire(BUFF_KEY(discordId), def.durationSec + 60);

  return { success: true, buff: def, expiresAt };
}

export async function getActiveBuffs(discordId: string): Promise<{ buff: BuffDef; expiresAt: number; remainingSec: number }[]> {
  const all = await redis.hgetall(BUFF_KEY(discordId));
  const now = Date.now();
  const active: { buff: BuffDef; expiresAt: number; remainingSec: number }[] = [];

  for (const [id, exp] of Object.entries(all)) {
    const expiresAt = parseInt(exp);
    if (expiresAt <= now) continue;
    const def = BUFFS.find((b) => b.id === id);
    if (!def) continue;
    active.push({ buff: def, expiresAt, remainingSec: Math.ceil((expiresAt - now) / 1000) });
  }

  return active;
}

export async function hasActiveBuff(discordId: string, buffId: string): Promise<boolean> {
  const exp = await redis.hget(BUFF_KEY(discordId), buffId);
  if (!exp) return false;
  return parseInt(exp) > Date.now();
}

export async function getBuffEffect(discordId: string, effectKey: string): Promise<number | null> {
  const all = await redis.hgetall(BUFF_KEY(discordId));
  const now = Date.now();

  for (const [id, exp] of Object.entries(all)) {
    if (parseInt(exp) <= now) continue;
    const def = BUFFS.find((b) => b.id === id);
    if (def && effectKey in def.effect) return def.effect[effectKey];
  }
  return null;
}

export async function consumeBuff(discordId: string, buffId: string): Promise<void> {
  await redis.hdel(BUFF_KEY(discordId), buffId);
}
