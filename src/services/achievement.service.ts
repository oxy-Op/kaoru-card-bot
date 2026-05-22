import { db } from "../db/index.js";
import { achievements, userAchievements, users, cards, likeList } from "../db/schema.js";
import { eq, and, sql, count } from "drizzle-orm";

interface AchievementRow {
  id: number;
  code: string;
  name: string;
  description: string;
  category: string;
  requirementType: string;
  requirementValue: number;
  rewardType: string | null;
  rewardAmount: number | null;
  badgeEmoji: string | null;
}

export interface UserAchievementWithDetails {
  achievement: AchievementRow;
  progress: number;
  completed: boolean;
  claimed: boolean;
  completedAt: Date | null;
}

// ── Stat resolvers ───────────────────────────────────────

async function resolveStatValue(
  userId: number,
  requirementType: string
): Promise<number> {
  switch (requirementType) {
    case "total_summons": {
      const [row] = await db
        .select({ val: users.totalSummons })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row?.val ?? 0;
    }
    case "total_grabs": {
      const [row] = await db
        .select({ val: users.totalGrabs })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row?.val ?? 0;
    }
    case "total_fusions": {
      const [row] = await db
        .select({ val: users.totalFusions })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row?.val ?? 0;
    }
    case "total_trades": {
      const [row] = await db
        .select({ val: users.totalTrades })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row?.val ?? 0;
    }
    case "total_gifts": {
      const [row] = await db
        .select({ val: users.totalGifts })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row?.val ?? 0;
    }
    case "collection_size": {
      const [row] = await db
        .select({ val: count(cards.id) })
        .from(cards)
        .where(eq(cards.ownerId, userId));
      return row?.val ?? 0;
    }
    case "has_blurb": {
      const [row] = await db
        .select({ blurb: users.blurb })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row?.blurb ? 1 : 0;
    }
    case "has_wishlist": {
      const [row] = await db
        .select({ val: count(likeList.characterId) })
        .from(likeList)
        .where(eq(likeList.userId, userId));
      return (row?.val ?? 0) > 0 ? 1 : 0;
    }
    case "level": {
      const [row] = await db
        .select({ val: users.level })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row?.val ?? 1;
    }
    default:
      return 0;
  }
}

// ── Core functions ───────────────────────────────────────

/**
 * Check all achievements for a user and update progress / completion status.
 * Call this after stat-changing actions (summon, grab, fuse, trade, give, etc.).
 */
export async function checkAchievements(userId: number): Promise<void> {
  // Fetch all achievements
  const allAchievements = await db.select().from(achievements);
  if (allAchievements.length === 0) return;

  // Group by requirement_type to avoid repeated queries
  const byType = new Map<string, AchievementRow[]>();
  for (const a of allAchievements) {
    const list = byType.get(a.requirementType) ?? [];
    list.push(a);
    byType.set(a.requirementType, list);
  }

  for (const [reqType, achList] of byType) {
    const currentValue = await resolveStatValue(userId, reqType);

    for (const ach of achList) {
      const progress = Math.min(currentValue, ach.requirementValue);
      const completed = currentValue >= ach.requirementValue;

      // Upsert user_achievements row
      await db
        .insert(userAchievements)
        .values({
          userId,
          achievementId: ach.id,
          progress,
          completed,
          completedAt: completed ? new Date() : null,
        })
        .onConflictDoUpdate({
          target: [userAchievements.userId, userAchievements.achievementId],
          set: {
            progress,
            // Only mark completed if not already completed (preserve original completedAt)
            completed: sql`CASE WHEN ${userAchievements.completed} THEN true ELSE ${completed} END`,
            completedAt: sql`CASE WHEN ${userAchievements.completed} THEN ${userAchievements.completedAt} ELSE ${completed ? new Date().toISOString() : null}::timestamp END`,
          },
        });
    }
  }
}

/**
 * Get all achievements with user progress for display.
 */
export async function getAchievements(
  discordId: string
): Promise<UserAchievementWithDetails[]> {
  // Get user
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.discordId, discordId))
    .limit(1);

  if (!user) return [];

  // Run check to update progress before displaying
  await checkAchievements(user.id);

  // Fetch all achievements joined with user progress
  const allAch = await db.select().from(achievements);

  const userAchRows = await db
    .select()
    .from(userAchievements)
    .where(eq(userAchievements.userId, user.id));

  const userAchMap = new Map(
    userAchRows.map((ua) => [ua.achievementId, ua])
  );

  return allAch.map((ach) => {
    const ua = userAchMap.get(ach.id);
    return {
      achievement: ach,
      progress: ua?.progress ?? 0,
      completed: ua?.completed ?? false,
      claimed: ua?.claimed ?? false,
      completedAt: ua?.completedAt ?? null,
    };
  });
}

/**
 * Claim a completed achievement's reward.
 */
export async function claimReward(
  discordId: string,
  achievementId: number
): Promise<
  | { success: true; rewardType: string; rewardAmount: number; achievementName: string }
  | { success: false; reason: string }
> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.discordId, discordId))
    .limit(1);

  if (!user) return { success: false, reason: "User not found." };

  // Check user achievement status
  const [ua] = await db
    .select()
    .from(userAchievements)
    .where(
      and(
        eq(userAchievements.userId, user.id),
        eq(userAchievements.achievementId, achievementId)
      )
    )
    .limit(1);

  if (!ua || !ua.completed) {
    return { success: false, reason: "Achievement not completed yet." };
  }

  if (ua.claimed) {
    return { success: false, reason: "Reward already claimed." };
  }

  // Get achievement details
  const [ach] = await db
    .select()
    .from(achievements)
    .where(eq(achievements.id, achievementId))
    .limit(1);

  if (!ach) return { success: false, reason: "Achievement not found." };

  // Grant reward
  const rewardType = ach.rewardType ?? "gold";
  const rewardAmount = ach.rewardAmount ?? 0;

  if (rewardAmount > 0) {
    switch (rewardType) {
      case "gold":
        await db
          .update(users)
          .set({ gold: sql`${users.gold} + ${rewardAmount}` })
          .where(eq(users.id, user.id));
        break;
      case "shards":
        await db
          .update(users)
          .set({ shards: sql`${users.shards} + ${rewardAmount}` })
          .where(eq(users.id, user.id));
        break;
      case "cinders":
        await db
          .update(users)
          .set({ cinders: sql`${users.cinders} + ${rewardAmount}` })
          .where(eq(users.id, user.id));
        break;
      case "roses":
        await db
          .update(users)
          .set({ roses: sql`${users.roses} + ${rewardAmount}` })
          .where(eq(users.id, user.id));
        break;
      default:
        break;
    }
  }

  // If achievement has a badge, add it
  if (ach.badgeEmoji) {
    await db
      .update(users)
      .set({
        badges: sql`COALESCE(${users.badges}, '[]'::jsonb) || ${JSON.stringify([ach.badgeEmoji])}::jsonb`,
      })
      .where(eq(users.id, user.id));
  }

  // Mark as claimed
  await db
    .update(userAchievements)
    .set({ claimed: true })
    .where(
      and(
        eq(userAchievements.userId, user.id),
        eq(userAchievements.achievementId, achievementId)
      )
    );

  return {
    success: true,
    rewardType,
    rewardAmount,
    achievementName: ach.name,
  };
}
