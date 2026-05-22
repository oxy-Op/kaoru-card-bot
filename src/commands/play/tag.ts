import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { users, cards } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("tag")
  .setDescription("Tag or untag a card")
  .addStringOption((opt) => opt.setName("card").setDescription("Card code").setRequired(true))
  .addStringOption((opt) => opt.setName("name").setDescription("Tag name (leave empty to remove tag)"))
  .addStringOption((opt) => opt.setName("emoji").setDescription("Tag emoji"));

export async function execute(interaction: ChatInputCommandInteraction) {
  const code = interaction.options.getString("card", true).trim();
  const tagName = interaction.options.getString("name") ?? null;
  const tagEmoji = interaction.options.getString("emoji") ?? null;

  const userId = await ensureUser(interaction.user.id, interaction.user.username);

  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, code), eq(cards.ownerId, userId)),
    columns: { id: true },
  });

  if (!card) {
    await interaction.reply({ content: `You don't own card \`${code}\`.`, ephemeral: true });
    return;
  }

  await db
    .update(cards)
    .set({ tag: tagName, tagEmoji, updatedAt: new Date() })
    .where(eq(cards.id, card.id));

  if (tagName) {
    await interaction.reply(`Tagged \`${code}\` as ${tagEmoji ?? "🏷️"} **${tagName}**`);
  } else {
    await interaction.reply(`Removed tag from \`${code}\``);
  }
}
