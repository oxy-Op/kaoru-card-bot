import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "../../db/index.js";
import { characters, characterEditions } from "../../db/schema.js";
import { eq, sql, ilike } from "drizzle-orm";
import { isDevUser } from "../../config.js";
import { performSummon } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("spawn")
  .setDescription("(Admin) Force-spawn a summon with a specific character")
  .addStringOption((o) => o.setName("character").setDescription("Character name to guarantee in slot 1").setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!isDevUser(interaction.user.id)) {
    await interaction.reply({ content: "Only bot admins can use this command.", ephemeral: true });
    return;
  }

  // For now, just trigger a normal summon bypassing cooldown
  // A targeted spawn would need deeper integration with selectCharacters
  await interaction.reply({ content: "Use `ka!s` — dev cooldown bypass is active.", ephemeral: true });
}
