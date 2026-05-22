import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("profileset")
  .setDescription("Customize your profile")
  .addStringOption((opt) => opt.setName("setting").setDescription("What to change").setRequired(true)
    .addChoices(
      { name: "Color", value: "color" },
      { name: "Background", value: "background" },
      { name: "Opacity", value: "opacity" },
      { name: "Note", value: "note" },
    ))
  .addStringOption((opt) => opt.setName("value").setDescription("New value (empty to clear)"));

export async function execute(interaction: ChatInputCommandInteraction) {
  const setting = interaction.options.getString("setting", true);
  const value = interaction.options.getString("value") ?? null;
  const userId = await ensureUser(interaction.user.id, interaction.user.username);

  const updates: Record<string, any> = { updatedAt: new Date() };

  switch (setting) {
    case "color":
      updates.profileColor = value;
      break;
    case "background":
      updates.profileBg = value;
      break;
    case "opacity":
      updates.profileOpacity = value ? parseFloat(value) : 1.0;
      break;
    case "note":
      updates.profileNote = value;
      break;
  }

  await db.update(users).set(updates).where(eq(users.id, userId));
  await interaction.reply(value ? `Updated **${setting}** to \`${value}\`` : `Cleared **${setting}**.`);
}
