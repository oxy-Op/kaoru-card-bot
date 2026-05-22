import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  getAchievements,
  claimReward,
  type UserAchievementWithDetails,
} from "../../services/achievement.service.js";

const PAGE_SIZE = 5;
const CATEGORY_EMOJIS: Record<string, string> = {
  summon: "\u2728",      // sparkles
  grab: "\u{1F91A}",    // raised back of hand
  trade: "\u{1F91D}",   // handshake
  fusion: "\u{1F525}",  // fire
  social: "\u{1F493}",  // beating heart
  collection: "\u{1F3DB}\uFE0F", // classical building
};

export const data = new SlashCommandBuilder()
  .setName("achievements")
  .setDescription("View your achievements and claim rewards")
  .addStringOption((opt) =>
    opt
      .setName("category")
      .setDescription("Filter by category")
      .setRequired(false)
      .addChoices(
        { name: "Summon", value: "summon" },
        { name: "Grab", value: "grab" },
        { name: "Trade", value: "trade" },
        { name: "Fusion", value: "fusion" },
        { name: "Social", value: "social" },
        { name: "Collection", value: "collection" }
      )
  )
  .addIntegerOption((opt) =>
    opt
      .setName("claim")
      .setDescription("Achievement ID to claim reward for")
      .setRequired(false)
  );

function buildProgressBar(current: number, max: number): string {
  const filled = Math.floor((current / max) * 10);
  const empty = 10 - filled;
  return "\u25B0".repeat(filled) + "\u25B1".repeat(empty);
}

function buildAchievementEmbed(
  items: UserAchievementWithDetails[],
  page: number,
  totalPages: number,
  username: string,
  avatarUrl: string | null,
  category: string | null
): EmbedBuilder {
  const title = category
    ? `${CATEGORY_EMOJIS[category] ?? ""} ${category.charAt(0).toUpperCase() + category.slice(1)} Achievements`
    : "Achievements";

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: `${username}'s ${title}`, iconURL: avatarUrl ?? undefined })
    .setFooter({ text: `Page ${page}/${totalPages} | Use /achievements claim:<id> to claim rewards` });

  if (items.length === 0) {
    embed.setDescription("No achievements found.");
    return embed;
  }

  const lines = items.map((item) => {
    const a = item.achievement;
    const bar = buildProgressBar(item.progress, a.requirementValue);
    const status = item.claimed
      ? "\u2705"    // green check
      : item.completed
        ? "\u{1F381}" // gift box (claimable)
        : "\u{1F512}"; // locked
    const rewardLabel =
      a.rewardType && a.rewardAmount
        ? ` | +${a.rewardAmount} ${a.rewardType}`
        : "";
    const badge = a.badgeEmoji ? ` ${a.badgeEmoji}` : "";
    return (
      `${status} **${a.name}**${badge} \`#${a.id}\`\n` +
      `${a.description}\n` +
      `${bar} \u00B7 (${item.progress}/${a.requirementValue})${rewardLabel}`
    );
  });

  embed.setDescription(lines.join("\n\n"));
  return embed;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  // Handle claim
  const claimId = interaction.options.getInteger("claim");
  if (claimId !== null) {
    const result = await claimReward(interaction.user.id, claimId);
    if (result.success) {
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setDescription(
          `\u2705 Claimed reward for **${result.achievementName}**!\n` +
          `+**${result.rewardAmount} ${result.rewardType}**`
        );
      await interaction.reply({ embeds: [embed] });
    } else {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setDescription(result.reason);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    return;
  }

  await interaction.deferReply();

  const category = interaction.options.getString("category");
  let allAch = await getAchievements(interaction.user.id);

  if (category) {
    allAch = allAch.filter((a) => a.achievement.category === category);
  }

  // Sort: unclaimed completed first, then in-progress, then claimed
  allAch.sort((a, b) => {
    const aWeight = a.claimed ? 2 : a.completed ? 0 : 1;
    const bWeight = b.claimed ? 2 : b.completed ? 0 : 1;
    if (aWeight !== bWeight) return aWeight - bWeight;
    return a.achievement.id - b.achievement.id;
  });

  const totalPages = Math.max(1, Math.ceil(allAch.length / PAGE_SIZE));
  let page = 1;

  const getPage = (p: number) =>
    allAch.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);

  const buildRow = (p: number) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("ach:prev")
        .setLabel("\u25C0")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(p <= 1),
      new ButtonBuilder()
        .setCustomId("ach:page")
        .setLabel(`${p}/${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId("ach:next")
        .setLabel("\u25B6")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(p >= totalPages)
    );

  const embed = buildAchievementEmbed(
    getPage(page),
    page,
    totalPages,
    interaction.user.username,
    interaction.user.displayAvatarURL(),
    category
  );

  const msg = await interaction.editReply({
    embeds: [embed],
    components: totalPages > 1 ? [buildRow(page)] : [],
  });

  if (totalPages <= 1) return;

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === interaction.user.id,
    time: 120_000,
  });

  collector.on("collect", async (i) => {
    if (i.customId === "ach:prev") page = Math.max(1, page - 1);
    if (i.customId === "ach:next") page = Math.min(totalPages, page + 1);

    const newEmbed = buildAchievementEmbed(
      getPage(page),
      page,
      totalPages,
      interaction.user.username,
      interaction.user.displayAvatarURL(),
      category
    );

    await i.update({ embeds: [newEmbed], components: [buildRow(page)] });
  });

  collector.on("end", async () => {
    await interaction.editReply({ components: [] }).catch(() => {});
  });
}
