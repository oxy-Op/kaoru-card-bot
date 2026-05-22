import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getActiveEvent, getEventCards } from "../../services/events.service.js";

export const data = new SlashCommandBuilder()
  .setName("event")
  .setDescription("View the current seasonal event");

export async function execute(interaction: ChatInputCommandInteraction) {
  const event = await getActiveEvent();

  if (!event) {
    await interaction.reply({
      content: "No active event right now. Check back later!",
      ephemeral: true,
    });
    return;
  }

  const eventCardsPool = await getEventCards(event.id);
  const endsAt = Math.floor(event.endDate.getTime() / 1000);

  const charList = eventCardsPool.length > 0
    ? eventCardsPool.slice(0, 15).map((c) => `• **${c.charName}** — ${c.charSeries}`).join("\n")
    : "*No exclusive cards yet*";

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`🎉 ${event.name}`)
    .setDescription(
      `${event.description}\n\n` +
      `**Ends:** <t:${endsAt}:R>\n` +
      `**Reward Bonus:** ${event.rewardMultiplier}x\n\n` +
      `**Exclusive Cards:**\n${charList}`
    );

  if (event.bannerUrl) {
    embed.setImage(event.bannerUrl);
  }

  await interaction.reply({ embeds: [embed] });
}
