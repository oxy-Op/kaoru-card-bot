import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { eq } from "drizzle-orm";

export const data = new SlashCommandBuilder()
  .setName("userinfo")
  .setDescription("View detailed player statistics")
  .addUserOption((o) => o.setName("user").setDescription("User to check"));

export async function execute(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("user") ?? interaction.user;

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, target.id),
  });

  if (!user) {
    await interaction.reply({ content: "User hasn't started playing yet.", ephemeral: true });
    return;
  }

  if (target.id !== interaction.user.id && user.privateFields?.includes("userinfo")) {
    await interaction.reply({ content: "This user's info is private.", ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: `${target.username}'s Info`, iconURL: target.displayAvatarURL() })
    .addFields(
      {
        name: "Level & XP",
        value: `Level **${user.level}** · ${user.xp} XP`,
        inline: true,
      },
      {
        name: "Joined",
        value: `<t:${Math.floor(user.joinedAt.getTime() / 1000)}:R>`,
        inline: true,
      },
      {
        name: "\u200b",
        value: "\u200b",
        inline: true,
      },
      {
        name: "Summon Stats",
        value:
          `Total Summons · **${user.totalSummons}**\n` +
          `Total Grabs · **${user.totalGrabs}**\n` +
          `Claim Rate · **${user.totalSummons > 0 ? Math.round((user.totalGrabs / user.totalSummons) * 100) : 0}%**`,
        inline: true,
      },
      {
        name: "Economy Stats",
        value:
          `Total Fusions · **${user.totalFusions}**\n` +
          `Total Trades · **${user.totalTrades}**\n` +
          `Total Gifts · **${user.totalGifts}**`,
        inline: true,
      },
      {
        name: "Lists",
        value:
          `Summon List · **${user.summonListSlots}** slots\n` +
          `Like List · **${user.likeListSlots}** slots`,
        inline: true,
      }
    );

  await interaction.reply({ embeds: [embed] });
}
