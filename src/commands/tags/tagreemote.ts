import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { userTags, cards } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("tagreemote")
  .setDescription("Change the emoji for a tag")
  .addStringOption((o) => o.setName("name").setDescription("Tag name").setRequired(true))
  .addStringOption((o) => o.setName("emoji").setDescription("New emoji").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  const userId = await ensureUser(interaction.user.id, interaction.user.username);
  const name = interaction.options.getString("name", true).toLowerCase().trim();
  const emoji = interaction.options.getString("emoji", true).trim();

  const [existing] = await db.select().from(userTags).where(and(eq(userTags.userId, userId), eq(userTags.name, name))).limit(1);

  if (!existing) {
    await interaction.reply({ content: `Tag **${name}** not found.`, ephemeral: true });
    return;
  }

  await db.update(userTags).set({ emoji }).where(and(eq(userTags.userId, userId), eq(userTags.name, name)));
  await db.update(cards).set({ tagEmoji: emoji }).where(and(eq(cards.ownerId, userId), eq(cards.tag, name)));

  await interaction.reply(`${emoji} Tag **${name}** emoji updated!`);
}
