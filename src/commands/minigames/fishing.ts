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
import { users } from "../../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { getCooldown, setCooldown } from "../../cache/cooldowns.js";
import { ensureUser } from "../../services/summon.service.js";

interface FishEntry {
  name: string;
  emoji: string;
  rarity: string;
  goldMin: number;
  goldMax: number;
  weight: number;
}

const FISH_TABLE: FishEntry[] = [
  { name: "Old Boot", emoji: "👢", rarity: "Junk", goldMin: 1, goldMax: 3, weight: 15 },
  { name: "Seaweed", emoji: "🌿", rarity: "Junk", goldMin: 1, goldMax: 2, weight: 12 },
  { name: "Sardine", emoji: "🐟", rarity: "Common", goldMin: 5, goldMax: 10, weight: 25 },
  { name: "Bass", emoji: "🐟", rarity: "Common", goldMin: 8, goldMax: 15, weight: 20 },
  { name: "Salmon", emoji: "🐠", rarity: "Uncommon", goldMin: 15, goldMax: 30, weight: 12 },
  { name: "Pufferfish", emoji: "🐡", rarity: "Uncommon", goldMin: 20, goldMax: 35, weight: 8 },
  { name: "Swordfish", emoji: "⚔️", rarity: "Rare", goldMin: 40, goldMax: 60, weight: 4 },
  { name: "Golden Koi", emoji: "✨", rarity: "Epic", goldMin: 80, goldMax: 120, weight: 2.5 },
  { name: "Legendary Whale", emoji: "🐋", rarity: "Legendary", goldMin: 150, goldMax: 250, weight: 1 },
  { name: "Treasure Chest", emoji: "🎁", rarity: "Legendary", goldMin: 200, goldMax: 500, weight: 0.5 },
];

const RARITY_COLORS: Record<string, number> = {
  Junk: 0x95a5a6,
  Common: 0x2ecc71,
  Uncommon: 0x3498db,
  Rare: 0x9b59b6,
  Epic: 0xe67e22,
  Legendary: 0xf1c40f,
};

function rollFish(): FishEntry {
  const totalWeight = FISH_TABLE.reduce((sum, f) => sum + f.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const fish of FISH_TABLE) {
    roll -= fish.weight;
    if (roll <= 0) return fish;
  }
  return FISH_TABLE[0];
}

export const data = new SlashCommandBuilder()
  .setName("fish")
  .setDescription("Cast your line and catch something!");

export async function execute(interaction: ChatInputCommandInteraction) {
  const remaining = await getCooldown(interaction.user.id, "minigame");
  if (remaining > 0) {
    await interaction.reply({ content: `Minigame on cooldown! Ready <t:${Math.floor(Date.now() / 1000) + remaining}:R>`, ephemeral: true });
    return;
  }

  const castEmbed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("🎣 Fishing...")
    .setDescription("You cast your line into the water...");

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("fish:reel").setLabel("Reel In!").setStyle(ButtonStyle.Primary).setDisabled(true),
  );

  const msg = await interaction.reply({ embeds: [castEmbed], components: [row], fetchReply: true });

  const waitTime = 2000 + Math.floor(Math.random() * 3000);
  await new Promise((r) => setTimeout(r, waitTime));

  const biteEmbed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("🎣 Something's biting!")
    .setDescription("Quick! Reel it in!");

  const activeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("fish:reel").setLabel("Reel In!").setStyle(ButtonStyle.Success),
  );

  await msg.edit({ embeds: [biteEmbed], components: [activeRow] });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === interaction.user.id,
    time: 5_000,
    max: 1,
  });

  collector.on("collect", async (i) => {
    const fish = rollFish();
    const gold = fish.goldMin + Math.floor(Math.random() * (fish.goldMax - fish.goldMin + 1));

    const userId = await ensureUser(interaction.user.id, interaction.user.username);
    await db.update(users).set({ gold: sql`${users.gold} + ${gold}` }).where(eq(users.id, userId));
    await setCooldown(interaction.user.id, "minigame");

    await i.update({
      embeds: [
        new EmbedBuilder()
          .setColor(RARITY_COLORS[fish.rarity] ?? 0x2b2d31)
          .setTitle(`${fish.emoji} You caught a ${fish.name}!`)
          .setDescription(
            `**Rarity:** ${fish.rarity}\n` +
            `+💰 **${gold}** gold`
          )
      ],
      components: [],
    });
  });

  collector.on("end", async (collected) => {
    if (collected.size === 0) {
      await setCooldown(interaction.user.id, "minigame");
      await msg.edit({
        embeds: [
          new EmbedBuilder().setColor(0x95a5a6).setDescription("🐟 The fish got away! Too slow...")
        ],
        components: [],
      }).catch(() => {});
    }
  });
}
