import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { listBackgrounds, getUserBackgrounds, buyBackground, equipBackground } from "../../services/backgrounds.service.js";

export const data = new SlashCommandBuilder()
  .setName("background")
  .setDescription("Manage profile backgrounds")
  .addSubcommand((sub) =>
    sub.setName("shop").setDescription("Browse available backgrounds")
  )
  .addSubcommand((sub) =>
    sub.setName("buy").setDescription("Buy a background")
      .addIntegerOption((o) => o.setName("id").setDescription("Background ID").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub.setName("equip").setDescription("Set your active profile background")
      .addIntegerOption((o) => o.setName("id").setDescription("Background ID").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub.setName("owned").setDescription("View your owned backgrounds")
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "shop") {
    const bgs = await listBackgrounds();
    if (bgs.length === 0) {
      await interaction.reply({ content: "No backgrounds available yet.", ephemeral: true });
      return;
    }

    const list = bgs.map((bg) =>
      `\`#${bg.id}\` **${bg.name}** — ${bg.cost} gold (${bg.rarity})`
    ).join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("🖼️ Background Shop")
      .setDescription(list)
      .setFooter({ text: "Use /background buy <id> to purchase" });

    await interaction.reply({ embeds: [embed] });
  }

  else if (sub === "buy") {
    const bgId = interaction.options.getInteger("id", true);
    const result = await buyBackground(interaction.user.id, interaction.user.username, bgId);
    if (!result.success) {
      await interaction.reply({ content: result.reason, ephemeral: true });
      return;
    }
    await interaction.reply("🖼️ Background purchased! Use `/background equip` to set it.");
  }

  else if (sub === "equip") {
    const bgId = interaction.options.getInteger("id", true);
    const result = await equipBackground(interaction.user.id, interaction.user.username, bgId);
    if (!result.success) {
      await interaction.reply({ content: result.reason, ephemeral: true });
      return;
    }
    await interaction.reply("✅ Background equipped!");
  }

  else if (sub === "owned") {
    const owned = await getUserBackgrounds(interaction.user.id);
    if (owned.length === 0) {
      await interaction.reply({ content: "You don't own any backgrounds. Check `/background shop`!", ephemeral: true });
      return;
    }

    const list = owned.map((bg) => `\`#${bg.bgId}\` **${bg.name}** (${bg.rarity})`).join("\n");
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`🖼️ ${interaction.user.username}'s Backgrounds`)
      .setDescription(list);

    await interaction.reply({ embeds: [embed] });
  }
}
