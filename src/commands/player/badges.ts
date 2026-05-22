import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { users, userAchievements, achievements } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";

export const data = new SlashCommandBuilder()
  .setName("badges")
  .setDescription("View your earned badges")
  .addUserOption((o) => o.setName("user").setDescription("User to check"))
  .addStringOption((o) => o.setName("set").setDescription("Badge ID to set on profile"));

export async function execute(interaction: ChatInputCommandInteraction) {
  const setBadge = interaction.options.getString("set");

  if (setBadge) {
    await db
      .update(users)
      .set({ activeBadge: setBadge })
      .where(eq(users.discordId, interaction.user.id));
    await interaction.reply({ content: `Active badge set to **${setBadge}**.`, ephemeral: true });
    return;
  }

  const target = interaction.options.getUser("user") ?? interaction.user;

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, target.id),
    columns: { id: true, badges: true, activeBadge: true },
  });

  if (!user) {
    await interaction.reply({ content: "User hasn't started playing yet.", ephemeral: true });
    return;
  }

  const earned = await db
    .select({
      code: achievements.code,
      name: achievements.name,
      emoji: achievements.badgeEmoji,
    })
    .from(userAchievements)
    .innerJoin(achievements, eq(userAchievements.achievementId, achievements.id))
    .where(and(
      eq(userAchievements.userId, user.id),
      eq(userAchievements.completed, true),
    ));

  const badgeAchievements = earned.filter((a) => a.emoji);

  if (badgeAchievements.length === 0) {
    await interaction.reply({ content: `${target.username} hasn't earned any badges yet.`, ephemeral: true });
    return;
  }

  const lines = badgeAchievements.map((a) => {
    const active = user.activeBadge === a.code ? " ◀ active" : "";
    return `${a.emoji} **${a.name}** (\`${a.code}\`)${active}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: `${target.username}'s Badges`, iconURL: target.displayAvatarURL() })
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Use /badges set:<code> to display on profile" });

  await interaction.reply({ embeds: [embed] });
}
