import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { userTags, cards } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("tagremove")
  .setDescription("Delete a tag and untag all cards with it")
  .addStringOption((o) => o.setName("name").setDescription("Tag name").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  const userId = await ensureUser(interaction.user.id, interaction.user.username);
  const name = interaction.options.getString("name", true).toLowerCase().trim();

  const deleted = await db
    .delete(userTags)
    .where(and(eq(userTags.userId, userId), eq(userTags.name, name)))
    .returning();

  if (deleted.length === 0) {
    await interaction.reply({ content: `Tag **${name}** not found.`, ephemeral: true });
    return;
  }

  await db
    .update(cards)
    .set({ tag: null, tagEmoji: null })
    .where(and(eq(cards.ownerId, userId), eq(cards.tag, name)));

  await interaction.reply(`Tag **${name}** deleted and removed from all cards.`);
}
