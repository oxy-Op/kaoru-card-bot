import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { getUserFrames, getUserHexes, getUserAuras, getUserStickers } from "../../services/cosmetics.service.js";

export const data = new SlashCommandBuilder()
  .setName("cosmetics")
  .setDescription("View your cosmetic inventory")
  .addStringOption((opt) => opt.setName("type").setDescription("Type to view")
    .addChoices(
      { name: "Frames", value: "frames" },
      { name: "Hexes", value: "hexes" },
      { name: "Auras", value: "auras" },
      { name: "Stickers", value: "stickers" },
      { name: "All", value: "all" },
    ));

export async function execute(interaction: ChatInputCommandInteraction) {
  const type = interaction.options.getString("type") ?? "all";
  const sections: string[] = [];

  if (type === "all" || type === "frames") {
    const items = await getUserFrames(interaction.user.id);
    if (items.length > 0) {
      sections.push("**Frames**\n" + items.map((f) => `#${f.frameId} ${f.name} ×${f.quantity}`).join("\n"));
    }
  }
  if (type === "all" || type === "hexes") {
    const items = await getUserHexes(interaction.user.id);
    if (items.length > 0) {
      sections.push("**Hexes**\n" + items.map((h) => `#${h.hexId} ${h.name} ${h.colorPrimary} ×${h.quantity}`).join("\n"));
    }
  }
  if (type === "all" || type === "auras") {
    const items = await getUserAuras(interaction.user.id);
    if (items.length > 0) {
      sections.push("**Auras**\n" + items.map((a) => `#${a.auraId} ${a.name} ${a.glowColor} ×${a.quantity}`).join("\n"));
    }
  }
  if (type === "all" || type === "stickers") {
    const items = await getUserStickers(interaction.user.id);
    if (items.length > 0) {
      sections.push("**Stickers**\n" + items.map((s) => `#${s.stickerId} ${s.name} (${s.rarity}) ×${s.quantity}`).join("\n"));
    }
  }

  if (sections.length === 0) {
    await interaction.reply("Your cosmetic inventory is empty. Try `/open` to get some!");
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`${interaction.user.username}'s Cosmetics`)
    .setDescription(sections.join("\n\n"));

  await interaction.reply({ embeds: [embed] });
}
