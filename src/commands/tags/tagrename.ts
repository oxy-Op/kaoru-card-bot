import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { userTags, cards } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("tagrename")
  .setDescription("Rename an existing tag")
  .addStringOption((o) => o.setName("old").setDescription("Current tag name").setRequired(true))
  .addStringOption((o) => o.setName("new").setDescription("New tag name").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  const userId = await ensureUser(interaction.user.id, interaction.user.username);
  const oldName = interaction.options.getString("old", true).toLowerCase().trim();
  const newName = interaction.options.getString("new", true).toLowerCase().trim();

  if (newName.length > 30) {
    await interaction.reply({ content: "Tag name must be 30 characters or less.", ephemeral: true });
    return;
  }

  const existing = await db.query.userTags?.findFirst?.({
    where: and(eq(userTags.userId, userId), eq(userTags.name, oldName)),
  }) ?? await db.select().from(userTags).where(and(eq(userTags.userId, userId), eq(userTags.name, oldName))).limit(1).then(r => r[0]);

  if (!existing) {
    await interaction.reply({ content: `Tag **${oldName}** not found.`, ephemeral: true });
    return;
  }

  try {
    await db.delete(userTags).where(and(eq(userTags.userId, userId), eq(userTags.name, oldName)));
    await db.insert(userTags).values({ userId, name: newName, emoji: existing.emoji });
    await db.update(cards).set({ tag: newName }).where(and(eq(cards.ownerId, userId), eq(cards.tag, oldName)));
    await interaction.reply(`Tag renamed: **${oldName}** → **${newName}**`);
  } catch {
    await interaction.reply({ content: `Tag **${newName}** already exists.`, ephemeral: true });
  }
}
