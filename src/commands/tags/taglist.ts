import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { userTags, cards } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("taglist")
  .setDescription("View all your tags and card counts");

export async function execute(interaction: ChatInputCommandInteraction) {
  const userId = await ensureUser(interaction.user.id, interaction.user.username);

  const tags = await db.select().from(userTags).where(eq(userTags.userId, userId)).orderBy(userTags.name);

  if (tags.length === 0) {
    await interaction.reply({ content: "You haven't created any tags yet. Use `/tagadd` to create one!", ephemeral: true });
    return;
  }

  const counts = await db
    .select({ tag: cards.tag, count: sql<number>`count(*)` })
    .from(cards)
    .where(and(eq(cards.ownerId, userId), sql`${cards.tag} IS NOT NULL`))
    .groupBy(cards.tag);

  const countMap = new Map(counts.map((c) => [c.tag, c.count]));

  const lines = tags.map((t) => {
    const count = countMap.get(t.name) ?? 0;
    return `${t.emoji} **${t.name}** · ${count} card${count !== 1 ? "s" : ""}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: `${interaction.user.username}'s Tags`, iconURL: interaction.user.displayAvatarURL() })
    .setDescription(lines.join("\n"))
    .setFooter({ text: `${tags.length}/100 tags` });

  await interaction.reply({ embeds: [embed] });
}
