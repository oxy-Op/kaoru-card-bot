import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { openPack } from "../../services/cosmetics.service.js";

export const data = new SlashCommandBuilder()
  .setName("open")
  .setDescription("Open a pack for random cosmetics")
  .addStringOption((opt) => opt.setName("type").setDescription("Pack type").setRequired(true)
    .addChoices(
      { name: "Hex Pack (200g)", value: "hex" },
      { name: "Sticker Pack (150g)", value: "sticker" },
    ));

export async function execute(interaction: ChatInputCommandInteraction) {
  const type = interaction.options.getString("type", true) as "hex" | "sticker";

  const result = await openPack(interaction.user.id, interaction.user.username, type);

  if (!result.success) {
    await interaction.reply({ content: result.reason, ephemeral: true });
    return;
  }

  await interaction.reply(`📦 Opened a **${type} pack**! Got:\n${result.items.map((i) => `• ${i}`).join("\n")}`);
}
