import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("divorce")
  .setDescription("End your current partnership");

export async function execute(interaction: ChatInputCommandInteraction) {
  const userId = await ensureUser(interaction.user.id, interaction.user.username);
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { partnerId: true } });

  if (!user?.partnerId) {
    await interaction.reply({ content: "You don't have a partner.", ephemeral: true });
    return;
  }

  // Clear both sides
  await db.update(users).set({ partnerId: null }).where(eq(users.id, userId));
  await db.update(users).set({ partnerId: null }).where(eq(users.id, user.partnerId));

  await interaction.reply("💔 Partnership ended.");
}
