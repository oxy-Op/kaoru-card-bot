import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { users, achievements, userAchievements } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("completeachievement")
  .setDescription("Claim rewards for completed achievements")
  .addStringOption((o) => o.setName("id").setDescription("Achievement code to claim (or leave empty for all)"));

export async function execute(interaction: ChatInputCommandInteraction) {
  const userId = await ensureUser(interaction.user.id, interaction.user.username);
  const targetCode = interaction.options.getString("id");

  const unclaimed = await db
    .select({
      uaUserId: userAchievements.userId,
      uaAchievementId: userAchievements.achievementId,
      code: achievements.code,
      name: achievements.name,
      rewardType: achievements.rewardType,
      rewardAmount: achievements.rewardAmount,
      badgeEmoji: achievements.badgeEmoji,
    })
    .from(userAchievements)
    .innerJoin(achievements, eq(userAchievements.achievementId, achievements.id))
    .where(and(
      eq(userAchievements.userId, userId),
      eq(userAchievements.completed, true),
      eq(userAchievements.claimed, false),
      ...(targetCode ? [eq(achievements.code, targetCode)] : []),
    ));

  if (unclaimed.length === 0) {
    await interaction.reply({
      content: targetCode
        ? `Achievement \`${targetCode}\` is not ready to claim.`
        : "No unclaimed achievements.",
      ephemeral: true,
    });
    return;
  }

  const rewards: string[] = [];

  for (const ach of unclaimed) {
    await db
      .update(userAchievements)
      .set({ claimed: true })
      .where(and(
        eq(userAchievements.userId, userId),
        eq(userAchievements.achievementId, ach.uaAchievementId),
      ));

    if (ach.rewardType && ach.rewardAmount) {
      const col = ach.rewardType as keyof typeof users;
      if (col === "gold" || col === "opals" || col === "roses" || col === "cinders" || col === "shards") {
        await db.update(users).set({
          [col]: sql`${users[col]} + ${ach.rewardAmount}`,
        } as any).where(eq(users.id, userId));
      }
    }

    if (ach.badgeEmoji) {
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { badges: true },
      });
      const badges = user?.badges ?? [];
      if (!badges.includes(ach.code)) {
        badges.push(ach.code);
        await db.update(users).set({ badges }).where(eq(users.id, userId));
      }
    }

    const rewardText = ach.rewardType && ach.rewardAmount
      ? ` → +${ach.rewardAmount} ${ach.rewardType}`
      : "";
    const badgeText = ach.badgeEmoji ? ` ${ach.badgeEmoji}` : "";
    rewards.push(`✅ **${ach.name}**${rewardText}${badgeText}`);
  }

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("🏆 Achievements Claimed!")
    .setDescription(rewards.join("\n"));

  await interaction.reply({ embeds: [embed] });
}
