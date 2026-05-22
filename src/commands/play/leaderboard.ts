import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "../../db/index.js";
import { users, cards } from "../../db/schema.js";
import { eq, sql, desc, count } from "drizzle-orm";

type LeaderboardType = "cards" | "summons" | "grabs" | "gold" | "gifts";

const BOARD_CONFIG: Record<LeaderboardType, { title: string; emoji: string }> = {
  cards:   { title: "Most Cards",    emoji: "🃏" },
  summons: { title: "Most Summons",  emoji: "✨" },
  grabs:   { title: "Most Grabs",    emoji: "🤚" },
  gold:    { title: "Richest",       emoji: "💰" },
  gifts:   { title: "Most Generous", emoji: "🎁" },
};

const BOARD_TYPES = Object.keys(BOARD_CONFIG) as LeaderboardType[];
const PAGE_SIZE = 10;

export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("View global rankings")
  .addStringOption((opt) =>
    opt
      .setName("type")
      .setDescription("Leaderboard category")
      .setRequired(false)
      .addChoices(
        { name: "Cards owned", value: "cards" },
        { name: "Total summons", value: "summons" },
        { name: "Total grabs", value: "grabs" },
        { name: "Gold", value: "gold" },
        { name: "Gifts given", value: "gifts" },
      )
  );

async function fetchLeaderboard(type: LeaderboardType, page: number = 0) {
  const offset = page * PAGE_SIZE;

  if (type === "cards") {
    // Count cards per owner
    const rows = await db
      .select({
        discordId: users.discordId,
        username: users.username,
        value: count(cards.id),
      })
      .from(cards)
      .innerJoin(users, eq(cards.ownerId, users.id))
      .groupBy(users.id, users.discordId, users.username)
      .orderBy(desc(count(cards.id)))
      .limit(PAGE_SIZE)
      .offset(offset);
    return rows;
  }

  const colMap: Record<string, any> = {
    summons: users.totalSummons,
    grabs: users.totalGrabs,
    gold: users.gold,
    gifts: users.totalGifts,
  };

  const col = colMap[type];
  const rows = await db
    .select({
      discordId: users.discordId,
      username: users.username,
      value: col,
    })
    .from(users)
    .orderBy(desc(col))
    .limit(PAGE_SIZE)
    .offset(offset);

  return rows;
}

function buildEmbed(
  type: LeaderboardType,
  rows: { discordId: string; username: string; value: number }[],
  page: number,
  requesterId: string
) {
  const cfg = BOARD_CONFIG[type];
  const offset = page * PAGE_SIZE;

  let description = "";
  if (rows.length === 0) {
    description = "No data yet. Start playing!";
  } else {
    description = rows
      .map((r, i) => {
        const rank = offset + i + 1;
        const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `\`${rank}.\``;
        const you = r.discordId === requesterId ? " ← you" : "";
        return `${medal} **${r.username}** — ${r.value.toLocaleString()}${you}`;
      })
      .join("\n");
  }

  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`${cfg.emoji} Leaderboard — ${cfg.title}`)
    .setDescription(description)
    .setFooter({ text: `Page ${page + 1} | Use buttons to navigate` });
}

function buildButtons(type: LeaderboardType, page: number) {
  const typeIdx = BOARD_TYPES.indexOf(type);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`lb:prev:${type}:${page}`)
      .setLabel("◀")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`lb:next:${type}:${page}`)
      .setLabel("▶")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`lb:cat:${BOARD_TYPES[(typeIdx + 1) % BOARD_TYPES.length]}:0`)
      .setLabel(BOARD_CONFIG[BOARD_TYPES[(typeIdx + 1) % BOARD_TYPES.length]].title)
      .setStyle(ButtonStyle.Primary),
  );
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const type = (interaction.options.getString("type") ?? "cards") as LeaderboardType;
  let page = 0;

  const rows = await fetchLeaderboard(type, page);
  const embed = buildEmbed(type, rows, page, interaction.user.id);
  const buttons = buildButtons(type, page);

  const msg = await interaction.reply({ embeds: [embed], components: [buttons], fetchReply: true });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120_000,
  });

  collector.on("collect", async (btn) => {
    if (btn.user.id !== interaction.user.id) {
      await btn.reply({ content: "Use your own `/leaderboard`!", ephemeral: true });
      return;
    }

    const [, action, boardType, pageStr] = btn.customId.split(":");
    let newType = boardType as LeaderboardType;
    let newPage = parseInt(pageStr, 10);

    if (action === "prev") newPage = Math.max(0, newPage - 1);
    else if (action === "next") newPage = newPage + 1;
    // "cat" = category switch, newPage is already 0

    const newRows = await fetchLeaderboard(newType, newPage);
    if (newRows.length === 0 && newPage > 0) {
      await btn.reply({ content: "No more results.", ephemeral: true });
      return;
    }

    const newEmbed = buildEmbed(newType, newRows, newPage, interaction.user.id);
    const newButtons = buildButtons(newType, newPage);
    await btn.update({ embeds: [newEmbed], components: [newButtons] });
  });

  collector.on("end", async () => {
    try { await msg.edit({ components: [] }); } catch {}
  });
}
