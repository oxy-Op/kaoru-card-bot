import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { userTags } from "../../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

const MAX_TAGS = 100;

export const data = new SlashCommandBuilder()
  .setName("tagadd")
  .setDescription("Create a new tag for organizing cards")
  .addStringOption((o) => o.setName("name").setDescription("Tag name").setRequired(true))
  .addStringOption((o) => o.setName("emoji").setDescription("Tag emoji").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  const userId = await ensureUser(interaction.user.id, interaction.user.username);
  const name = interaction.options.getString("name", true).toLowerCase().trim();
  const emoji = interaction.options.getString("emoji", true).trim();

  if (name.length > 30) {
    await interaction.reply({ content: "Tag name must be 30 characters or less.", ephemeral: true });
    return;
  }

  const [count] = await db
    .select({ total: sql<number>`count(*)` })
    .from(userTags)
    .where(eq(userTags.userId, userId));

  if ((count?.total ?? 0) >= MAX_TAGS) {
    await interaction.reply({ content: `You can have a maximum of ${MAX_TAGS} tags.`, ephemeral: true });
    return;
  }

  try {
    await db.insert(userTags).values({ userId, name, emoji });
    await interaction.reply(`${emoji} Tag **${name}** created! Use \`/tag\` to apply it to cards.`);
  } catch {
    await interaction.reply({ content: `Tag **${name}** already exists.`, ephemeral: true });
  }
}
