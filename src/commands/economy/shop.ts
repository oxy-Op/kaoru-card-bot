import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { shopItems } from "../../db/schema.js";
import { eq } from "drizzle-orm";

export const data = new SlashCommandBuilder()
  .setName("shop")
  .setDescription("View the shop");

export async function execute(interaction: ChatInputCommandInteraction) {
  const items = await db.query.shopItems.findMany({
    where: eq(shopItems.isAvailable, true),
  });

  if (items.length === 0) {
    await interaction.reply("The shop is empty right now. Check back later!");
    return;
  }

  const lines = items.map((item, i) => {
    const stock = item.stockLimit ? ` (${item.stockLimit} left)` : "";
    const costType = item.costType === "opals" ? "petals" : item.costType;
    return `**${i + 1}.** ${item.name} — ${item.costAmount} ${costType}${stock}\n${item.description ?? ""}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🛒 Shop")
    .setDescription(lines.join("\n\n"));

  await interaction.reply({ embeds: [embed] });
}
