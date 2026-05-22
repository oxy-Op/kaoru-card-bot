import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { cards } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("untag")
  .setDescription("Remove the tag from a card")
  .addStringOption((o) => o.setName("code").setDescription("Card code").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  const userId = await ensureUser(interaction.user.id, interaction.user.username);
  const code = interaction.options.getString("code", true).trim();

  const result = await db
    .update(cards)
    .set({ tag: null, tagEmoji: null })
    .where(and(eq(cards.code, code), eq(cards.ownerId, userId)))
    .returning({ id: cards.id });

  if (result.length === 0) {
    await interaction.reply({ content: `You don't own card \`${code}\` or it has no tag.`, ephemeral: true });
    return;
  }

  await interaction.reply(`Tag removed from card \`${code}\`.`);
}
