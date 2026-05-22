import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { giveCard, giveGold } from "../../services/economy.service.js";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("give")
  .setDescription("Give a card or gold to another user")
  .addUserOption((opt) => opt.setName("user").setDescription("Who to give to").setRequired(true))
  .addStringOption((opt) => opt.setName("card").setDescription("Card code to give"))
  .addIntegerOption((opt) => opt.setName("gold").setDescription("Gold amount to give").setMinValue(1));

export async function execute(interaction: ChatInputCommandInteraction) {
  await ensureUser(interaction.user.id, interaction.user.username);

  const target = interaction.options.getUser("user", true);
  const cardCode = interaction.options.getString("card");
  const goldAmount = interaction.options.getInteger("gold");

  if (!cardCode && !goldAmount) {
    await interaction.reply({ content: "Specify a card code or gold amount to give.", ephemeral: true });
    return;
  }

  const successLines: string[] = [];

  if (cardCode) {
    const result = await giveCard(
      interaction.user.id, interaction.user.username,
      target.id, target.username, cardCode
    );
    if (!result.success) {
      await interaction.reply({ content: result.reason, ephemeral: true });
      return;
    }
    successLines.push(`🎁 **${interaction.user.username}** gave \`${cardCode}\` to **${target.username}**!`);
  }

  if (goldAmount) {
    const result = await giveGold(
      interaction.user.id, interaction.user.username,
      target.id, target.username, goldAmount
    );
    if (!result.success) {
      await interaction.reply({ content: result.reason, ephemeral: true });
      return;
    }
    successLines.push(`💰 **${interaction.user.username}** gave **${goldAmount} gold** to **${target.username}**!`);
  }

  await interaction.reply(successLines.join("\n"));
}
