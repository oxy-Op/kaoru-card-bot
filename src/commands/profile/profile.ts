import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { users, cards } from "../../db/schema.js";
import { eq, count } from "drizzle-orm";

export const data = new SlashCommandBuilder()
  .setName("profile")
  .setDescription("View a player profile")
  .addUserOption((opt) => opt.setName("user").setDescription("User to view"));

export async function execute(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("user") ?? interaction.user;

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, target.id),
  });

  if (!user) {
    await interaction.reply({ content: "That user hasn't started playing yet.", ephemeral: true });
    return;
  }
  if (
    target.id !== interaction.user.id &&
    (user.privateFields?.includes("profile") || user.privateFields?.includes("userinfo"))
  ) {
    await interaction.reply({ content: "This user's profile is private.", ephemeral: true });
    return;
  }

  const [{ total: cardCount }] = await db
    .select({ total: count() })
    .from(cards)
    .where(eq(cards.ownerId, user.id));

  const embed = new EmbedBuilder()
    .setColor(parseInt(user.profileColor ?? "3498db", 16))
    .setTitle(`${target.username}'s Profile`)
    .setThumbnail(target.displayAvatarURL())
    .setDescription(user.blurb ?? "*No blurb set.*")
    .addFields(
      { name: "Cards", value: String(cardCount), inline: true },
      { name: "Gold", value: String(user.gold), inline: true },
      { name: "Petals", value: String(user.opals), inline: true },
      { name: "Roses", value: String(user.roses), inline: true },
      { name: "Cinders", value: String(user.cinders), inline: true },
      { name: "Shards", value: String(user.shards), inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Summons", value: String(user.totalSummons), inline: true },
      { name: "Grabs", value: String(user.totalGrabs), inline: true },
      { name: "Trades", value: String(user.totalTrades), inline: true },
      { name: "Fusions", value: String(user.totalFusions), inline: true },
      { name: "Gifts", value: String(user.totalGifts), inline: true },
    );

  if (user.partnerId) {
    const partner = await db.query.users.findFirst({
      where: eq(users.id, user.partnerId),
      columns: { username: true },
    });
    if (partner) embed.addFields({ name: "Partner", value: partner.username, inline: true });
  }

  await interaction.reply({ embeds: [embed] });
}
