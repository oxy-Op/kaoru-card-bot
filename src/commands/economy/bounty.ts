import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { cancelBounty, claimBounty, listActiveBounties, postBounty } from "../../services/bounty.service.js";

export const data = new SlashCommandBuilder()
  .setName("bounty")
  .setDescription("Post and claim character bounties")
  .addSubcommand((sub) =>
    sub
      .setName("post")
      .setDescription("Post a bounty in gold for a character")
      .addStringOption((o) => o.setName("character").setDescription("Character name").setRequired(true))
      .addIntegerOption((o) => o.setName("gold").setDescription("Gold bounty amount").setRequired(true).setMinValue(1))
  )
  .addSubcommand((sub) =>
    sub
      .setName("claim")
      .setDescription("Claim a bounty by submitting a matching card")
      .addIntegerOption((o) => o.setName("bounty_id").setDescription("Bounty ID").setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName("card_code").setDescription("Your card code").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName("cancel")
      .setDescription("Cancel your active bounty and refund escrow")
      .addIntegerOption((o) => o.setName("bounty_id").setDescription("Bounty ID").setRequired(true).setMinValue(1))
  )
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("List active bounty board entries")
      .addIntegerOption((o) => o.setName("limit").setDescription("Number of rows").setRequired(false).setMinValue(1).setMaxValue(20))
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "post") {
    const character = interaction.options.getString("character", true);
    const gold = interaction.options.getInteger("gold", true);
    const result = await postBounty(interaction.user.id, interaction.user.username, character, gold);
    if (!result.success) {
      await interaction.reply({ content: result.reason, ephemeral: true });
      return;
    }

    await interaction.reply(
      `📌 Bounty #${result.bountyId} posted for **${result.characterName}** (${result.series}).\n` +
      `💰 Escrow: **${result.goldAmount.toLocaleString()} gold**\n` +
      `⏳ Expires: <t:${Math.floor(result.expiresAt.getTime() / 1000)}:R>`
    );
    return;
  }

  if (sub === "claim") {
    const bountyId = interaction.options.getInteger("bounty_id", true);
    const cardCode = interaction.options.getString("card_code", true).trim();
    const result = await claimBounty(interaction.user.id, interaction.user.username, bountyId, cardCode);
    if (!result.success) {
      await interaction.reply({ content: result.reason, ephemeral: true });
      return;
    }

    await interaction.reply(
      `✅ Bounty #${bountyId} fulfilled!\n` +
      `You delivered **${result.characterName}** to **${result.requesterName}** and earned **${result.payout.toLocaleString()} gold**.`
    );
    return;
  }

  if (sub === "cancel") {
    const bountyId = interaction.options.getInteger("bounty_id", true);
    const result = await cancelBounty(interaction.user.id, interaction.user.username, bountyId);
    if (!result.success) {
      await interaction.reply({ content: result.reason, ephemeral: true });
      return;
    }
    await interaction.reply(`🧾 Bounty #${bountyId} cancelled. Refunded **${result.refunded.toLocaleString()} gold**.`);
    return;
  }

  const limit = interaction.options.getInteger("limit") ?? 10;
  const rows = await listActiveBounties(limit);
  if (rows.length === 0) {
    await interaction.reply({ content: "No active bounties right now.", ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("Bounty Board")
    .setDescription(
      rows
        .map((b) => {
          const exp = Math.floor(b.expiresAt.getTime() / 1000);
          return `#${b.id} • **${b.characterName}** (${b.series})\n` +
            `💰 ${b.goldAmount.toLocaleString()} gold • by **${b.requesterName}** • expires <t:${exp}:R>`;
        })
        .join("\n\n")
    );

  await interaction.reply({ embeds: [embed] });
}
