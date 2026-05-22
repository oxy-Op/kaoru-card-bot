import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";

// XP required per level: level N needs N * 100 XP to reach next tier.
// Level 1: 0 XP, Level 2: 100 XP, Level 3: 300 XP, ..., Level 7: 2100 XP total.
export function xpForLevel(level: number): number {
  return level * 100;
}

export function totalXpForLevel(level: number): number {
  // Sum of xpForLevel(1) + ... + xpForLevel(level-1)
  // = 100 * (1 + 2 + ... + (level-1)) = 100 * (level-1) * level / 2
  return 100 * (level - 1) * level / 2;
}

export function levelFromTotalXp(totalXp: number): number {
  // Inverse of totalXpForLevel
  // 100 * (L-1) * L / 2 <= totalXp
  // L^2 - L - 2*totalXp/100 <= 0
  // L <= (1 + sqrt(1 + 8*totalXp/100)) / 2
  return Math.floor((1 + Math.sqrt(1 + 8 * totalXp / 100)) / 2);
}

// XP rewards for actions
const XP_REWARDS = {
  summon: 15,
  grab: 25,
  daily: 10,
  fuse: 30,
  trade: 20,
  give: 5,
  vote: 20,
};

export type XpAction = keyof typeof XP_REWARDS;

/** Award XP for an action. Returns new level if leveled up, null otherwise. */
export async function awardXp(
  userId: number,
  action: XpAction,
  discordId?: string
): Promise<{ newXp: number; newLevel: number; leveledUp: boolean }> {
  let amount = XP_REWARDS[action];

  // Scholar's Insight buff: +50% XP
  if (discordId) {
    try {
      const { getBuffEffect } = await import("./buff.service.js");
      const xpMult = await getBuffEffect(discordId, "xpMult");
      if (xpMult) amount = Math.ceil(amount * xpMult);
    } catch { /* buff service unavailable */ }
  }

  const [updated] = await db
    .update(users)
    .set({ xp: sql`${users.xp} + ${amount}` })
    .where(eq(users.id, userId))
    .returning({ xp: users.xp, level: users.level });

  const newLevel = levelFromTotalXp(updated.xp);
  const leveledUp = newLevel > updated.level;

  if (leveledUp) {
    await db.update(users).set({ level: newLevel }).where(eq(users.id, userId));
  }

  return { newXp: updated.xp, newLevel, leveledUp };
}

/** Get a user's level info. */
export async function getLevelInfo(userId: number) {
  const [user] = await db
    .select({ xp: users.xp, level: users.level })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return { xp: 0, level: 1, xpForNext: 100, progress: 0 };

  const currentLevelXp = totalXpForLevel(user.level);
  const nextLevelXp = totalXpForLevel(user.level + 1);
  const xpInLevel = user.xp - currentLevelXp;
  const xpNeeded = nextLevelXp - currentLevelXp;
  const progress = Math.min(1, xpInLevel / xpNeeded);

  return {
    xp: user.xp,
    level: user.level,
    xpForNext: xpNeeded,
    xpInLevel,
    progress,
  };
}

/** Check if a user meets a level requirement. */
export async function checkLevel(userId: number, requiredLevel: number): Promise<boolean> {
  const [user] = await db
    .select({ level: users.level })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return (user?.level ?? 1) >= requiredLevel;
}

// Level requirements for features
export const LEVEL_REQUIREMENTS = {
  // Economy spec: transfer actions are open (no hard level gate).
  give: 1,
  trade: 1,
  multitrade: 1,
  fusionboard: 3,
  summonlist: 2,
  cardhunter: 20,
};
