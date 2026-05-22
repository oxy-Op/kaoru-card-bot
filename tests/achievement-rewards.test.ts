import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { claimReward } from "../src/services/achievement.service.js";
import { achievements, userAchievements, users } from "../src/db/schema.js";
import { cleanup, closeDb, seedGuild, seedUser, testDb } from "./setup.js";

const DISCORD_ID = "test_achievement_rewards_user_999";
const ACH_CODE = "test_roses_reward";

let userId: number;
let achievementId: number;

beforeAll(async () => {
  await seedGuild("test_guild");
  userId = await seedUser(DISCORD_ID, "achRoseUser");

  const [ach] = await testDb
    .insert(achievements)
    .values({
      code: ACH_CODE,
      name: "Rose Reward Test",
      description: "Claim roses reward",
      category: "social",
      requirementType: "level",
      requirementValue: 1,
      rewardType: "roses",
      rewardAmount: 7,
    })
    .onConflictDoNothing()
    .returning({ id: achievements.id });

  if (ach) {
    achievementId = ach.id;
  } else {
    const [existing] = await testDb
      .select({ id: achievements.id })
      .from(achievements)
      .where(eq(achievements.code, ACH_CODE))
      .limit(1);
    achievementId = existing.id;
  }

  await testDb
    .insert(userAchievements)
    .values({
      userId,
      achievementId,
      progress: 1,
      completed: true,
      claimed: false,
      completedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [userAchievements.userId, userAchievements.achievementId],
      set: { progress: 1, completed: true, claimed: false, completedAt: new Date() },
    });
}, 15_000);

afterAll(async () => {
  await testDb
    .delete(userAchievements)
    .where(and(
      eq(userAchievements.userId, userId),
      eq(userAchievements.achievementId, achievementId)
    ));
  await testDb.delete(achievements).where(eq(achievements.id, achievementId));
  await cleanup();
  await closeDb();
}, 30_000);

describe("achievement rewards", () => {
  it("credits roses when claiming a roses achievement", async () => {
    await testDb.update(users).set({ roses: 0 }).where(eq(users.id, userId));

    const result = await claimReward(DISCORD_ID, achievementId);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.rewardType).toBe("roses");
    expect(result.rewardAmount).toBe(7);

    const [u] = await testDb
      .select({ roses: users.roses })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    expect(u.roses).toBe(7);
  });
});
