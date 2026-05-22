import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("blurb")
  .setDescription("Set your profile blurb")
  .addStringOption((opt) =>
    opt.setName("text").setDescription("Your blurb (leave empty to clear)").setMaxLength(200)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const text = interaction.options.getString("text") ?? null;
  const userId = await ensureUser(interaction.user.id, interaction.user.username);

  await db
    .update(users)
    .set({ blurb: text, updatedAt: new Date() })
    .where(eq(users.id, userId));

  if (text) {
    await interaction.reply(`Blurb updated: *${text}*`);
  } else {
    await interaction.reply("Blurb cleared.");
  }
}
