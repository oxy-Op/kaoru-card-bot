import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { applyFrame, applyHex, applyAura } from "../../services/cosmetics.service.js";

export const data = new SlashCommandBuilder()
  .setName("use")
  .setDescription("Apply a cosmetic to a card")
  .addStringOption((opt) => opt.setName("type").setDescription("Cosmetic type").setRequired(true)
    .addChoices({ name: "Frame", value: "frame" }, { name: "Hex", value: "hex" }, { name: "Aura", value: "aura" }))
  .addIntegerOption((opt) => opt.setName("id").setDescription("Cosmetic ID").setRequired(true))
  .addStringOption((opt) => opt.setName("card").setDescription("Card code").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  const type = interaction.options.getString("type", true);
  const id = interaction.options.getInteger("id", true);
  const card = interaction.options.getString("card", true).trim();

  const fns = { frame: applyFrame, hex: applyHex, aura: applyAura };
  const fn = fns[type as keyof typeof fns];

  const result = await fn(interaction.user.id, interaction.user.username, card, id);

  if (!result.success) {
    await interaction.reply({ content: result.reason, ephemeral: true });
    return;
  }

  await interaction.reply(`Applied **${type}** #${id} to \`${card}\`!`);
}
