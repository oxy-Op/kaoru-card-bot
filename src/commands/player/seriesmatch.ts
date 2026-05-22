import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { characters, cards, users } from "../../db/schema.js";
import { eq, sql, ilike, and } from "drizzle-orm";

export const data = new SlashCommandBuilder()
  .setName("seriesmatch")
  .setDescription("See how many characters you own from a series")
  .addStringOption((o) => o.setName("series").setDescription("Series name to search").setRequired(true))
  .addUserOption((o) => o.setName("user").setDescription("User to check"));

export async function execute(interaction: ChatInputCommandInteraction) {
  const seriesQuery = interaction.options.getString("series", true);
  const target = interaction.options.getUser("user") ?? interaction.user;

  const [userRow] = await db
    .select({ id: users.id, privateFields: users.privateFields })
    .from(users)
    .where(eq(users.discordId, target.id))
    .limit(1);
  if (!userRow) {
    await interaction.reply({ content: "User hasn't started playing yet.", ephemeral: true });
    return;
  }
  if (
    target.id !== interaction.user.id &&
    userRow.privateFields?.includes("collection")
  ) {
    await interaction.reply({ content: "This user's collection is private.", ephemeral: true });
    return;
  }

  const totalChars = await db
    .select({ id: characters.id, name: characters.name, series: characters.series })
    .from(characters)
    .where(ilike(characters.series, `%${seriesQuery}%`))
    .orderBy(characters.name);

  if (totalChars.length === 0) {
    await interaction.reply({ content: `No series found matching "${seriesQuery}".`, ephemeral: true });
    return;
  }

  const seriesName = totalChars[0].series;
  const charIds = totalChars.map((c) => c.id);

  const owned = await db
    .select({ characterId: cards.characterId })
    .from(cards)
    .where(and(
      eq(cards.ownerId, userRow.id),
      sql`${cards.characterId} = ANY(${charIds})`,
      sql`${cards.inFusionPile} = false`,
    ))
    .groupBy(cards.characterId);

  const ownedSet = new Set(owned.map((o) => o.characterId));
  const ownedCount = ownedSet.size;
  const totalCount = totalChars.length;
  const pct = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0;

  const bar = buildProgressBar(pct);

  const preview = totalChars.slice(0, 15).map((c) =>
    `${ownedSet.has(c.id) ? "✅" : "❌"} ${c.name}`
  ).join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: `${target.username}'s Series Match`, iconURL: target.displayAvatarURL() })
    .setDescription(
      `**${seriesName}**\n\n` +
      `${bar} **${pct}%**\n` +
      `${ownedCount} / ${totalCount} characters\n\n` +
      preview +
      (totalChars.length > 15 ? `\n... and ${totalChars.length - 15} more` : "")
    );

  await interaction.reply({ embeds: [embed] });
}

function buildProgressBar(pct: number): string {
  const filled = Math.round(pct / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}
