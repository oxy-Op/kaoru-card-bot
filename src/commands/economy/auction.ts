import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import {
  bidAuction,
  cancelAuction,
  createAuction,
  listActiveAuctions,
  settleAuction,
} from "../../services/auction.service.js";

export const data = new SlashCommandBuilder()
  .setName("auction")
  .setDescription("Auction house for card trading with gold bids")
  .addSubcommand((sub) =>
    sub
      .setName("create")
      .setDescription("List one of your cards for auction")
      .addStringOption((o) => o.setName("card_code").setDescription("Card code to list").setRequired(true))
      .addIntegerOption((o) => o.setName("starting_bid").setDescription("Starting bid in gold").setRequired(true).setMinValue(1))
      .addIntegerOption((o) =>
        o
          .setName("duration_minutes")
          .setDescription("Auction duration in minutes (1-1440)")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(1440)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("bid")
      .setDescription("Place a gold bid on an active auction")
      .addIntegerOption((o) => o.setName("auction_id").setDescription("Auction ID").setRequired(true).setMinValue(1))
      .addIntegerOption((o) => o.setName("gold").setDescription("Bid amount").setRequired(true).setMinValue(1))
  )
  .addSubcommand((sub) =>
    sub
      .setName("cancel")
      .setDescription("Cancel your own auction (before any bids)")
      .addIntegerOption((o) => o.setName("auction_id").setDescription("Auction ID").setRequired(true).setMinValue(1))
  )
  .addSubcommand((sub) =>
    sub
      .setName("settle")
      .setDescription("Settle an ended auction immediately")
      .addIntegerOption((o) => o.setName("auction_id").setDescription("Auction ID").setRequired(true).setMinValue(1))
  )
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("List active auctions")
      .addIntegerOption((o) => o.setName("limit").setDescription("Rows to show").setRequired(false).setMinValue(1).setMaxValue(20))
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "create") {
    const cardCode = interaction.options.getString("card_code", true).trim();
    const startingBid = interaction.options.getInteger("starting_bid", true);
    const durationMinutes = interaction.options.getInteger("duration_minutes", true);
    const result = await createAuction(
      interaction.user.id,
      interaction.user.username,
      cardCode,
      startingBid,
      durationMinutes
    );
    if (!result.success) {
      await interaction.reply({ content: result.reason, ephemeral: true });
      return;
    }

    await interaction.reply(
      `🏷️ Auction #${result.auctionId} created for \`${result.cardCode}\` (**${result.characterName}**).\n` +
      `💰 Starting bid: **${result.startingBid.toLocaleString()} gold**\n` +
      `⏳ Ends: <t:${Math.floor(result.endsAt.getTime() / 1000)}:R>`
    );
    return;
  }

  if (sub === "bid") {
    const auctionId = interaction.options.getInteger("auction_id", true);
    const gold = interaction.options.getInteger("gold", true);
    const result = await bidAuction(interaction.user.id, interaction.user.username, auctionId, gold);
    if (!result.success) {
      await interaction.reply({ content: result.reason, ephemeral: true });
      return;
    }

    await interaction.reply(
      `🪙 Bid placed on auction #${auctionId}: **${result.currentBid.toLocaleString()} gold**.\n` +
      `${result.antiSnipeExtended ? "🛡️ Anti-snipe triggered: +2 minutes.\n" : ""}` +
      `⏳ Ends: <t:${Math.floor(result.endsAt.getTime() / 1000)}:R>`
    );
    return;
  }

  if (sub === "cancel") {
    const auctionId = interaction.options.getInteger("auction_id", true);
    const result = await cancelAuction(interaction.user.id, interaction.user.username, auctionId);
    if (!result.success) {
      await interaction.reply({ content: result.reason, ephemeral: true });
      return;
    }
    await interaction.reply(`🧾 Auction #${auctionId} cancelled. Your card was returned.`);
    return;
  }

  if (sub === "settle") {
    const auctionId = interaction.options.getInteger("auction_id", true);
    const result = await settleAuction(auctionId);
    if (!result.success) {
      await interaction.reply({ content: result.reason, ephemeral: true });
      return;
    }
    if (result.status === "settled") {
      await interaction.reply(
        `✅ Auction #${auctionId} settled. Winning bid: **${result.finalBid.toLocaleString()} gold**.`
      );
    } else {
      await interaction.reply(`⌛ Auction #${auctionId} expired with no bids. Card returned to seller.`);
    }
    return;
  }

  const limit = interaction.options.getInteger("limit") ?? 10;
  const rows = await listActiveAuctions(limit);
  if (rows.length === 0) {
    await interaction.reply({ content: "No active auctions right now.", ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle("Auction House")
    .setDescription(
      rows
        .map((a) => {
          const current = a.currentBid ?? a.startingBid;
          const bidder = a.currentBidderName ? ` • bidder: **${a.currentBidderName}**` : "";
          return `#${a.id} • \`${a.cardCode}\` • **${a.characterName}** (${a.series})\n` +
            `⭐ ${a.quality} • #${a.printNumber} • seller: **${a.sellerName}**\n` +
            `💰 ${current.toLocaleString()} gold${bidder} • ends <t:${Math.floor(a.endsAt.getTime() / 1000)}:R>`;
        })
        .join("\n\n")
    );

  await interaction.reply({ embeds: [embed] });
}
