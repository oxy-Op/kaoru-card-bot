import {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  ComponentType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { db } from "../../db/index.js";
import { characters } from "../../db/schema.js";
import { sql } from "drizzle-orm";
import { getCooldown, setCooldown } from "../../cache/cooldowns.js";
import { ensureUser } from "../../services/summon.service.js";
import { users } from "../../db/schema.js";
import { eq } from "drizzle-orm";

export const data = new SlashCommandBuilder()
  .setName("guess")
  .setDescription("Guess the character from their initials! Rewards gold.");

export async function execute(interaction: ChatInputCommandInteraction) {
  const remaining = await getCooldown(interaction.user.id, "minigame");
  if (remaining > 0) {
    await interaction.reply({ content: `Minigame on cooldown! Ready <t:${Math.floor(Date.now() / 1000) + remaining}:R>`, ephemeral: true });
    return;
  }

  const [char] = await db
    .select({
      id: characters.id,
      name: characters.name,
      series: characters.series,
      popularity: characters.popularity,
      imageUrl: characters.imageUrl,
    })
    .from(characters)
    .where(sql`${characters.popularity} > 10 AND ${characters.imageUrl} IS NOT NULL`)
    .orderBy(sql`RANDOM()`)
    .limit(1);

  if (!char) {
    await interaction.reply({ content: "No characters available.", ephemeral: true });
    return;
  }

  const initials = char.name.split(/\s+/).map((w) => w[0]?.toUpperCase()).filter(Boolean).join(".");
  const difficulty = (char.popularity ?? 0) > 500 ? "Easy" : (char.popularity ?? 0) > 100 ? "Medium" : "Hard";
  const goldReward = difficulty === "Easy" ? 10 : difficulty === "Medium" ? 25 : 50;
  const hiddenName = char.name.replace(/[a-zA-Z]/g, (_, i) => {
    return Math.random() < 0.3 ? char.name[i] : "\\_";
  });

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("🎯 Character Guessing Game")
    .setDescription(
      `**Difficulty:** ${difficulty} (${goldReward} gold)\n\n` +
      `**Initials:** ${initials}\n` +
      `**Hint:** ${hiddenName}\n` +
      `**Series:** ${char.series}\n\n` +
      `Type the character's name in chat within 30 seconds!`
    )
    .setThumbnail(char.imageUrl);

  await interaction.reply({ embeds: [embed] });

  const filter = (m: any) => m.author.id === interaction.user.id;
  const channel = interaction.channel;
  if (!channel || !("awaitMessages" in channel)) return;

  try {
    const collected = await channel.awaitMessages({
      filter,
      max: 3,
      time: 30_000,
      errors: ["time"],
    });

    const correct = collected.find((m) =>
      m.content.toLowerCase().trim() === char.name.toLowerCase().trim() ||
      m.content.toLowerCase().trim().includes(char.name.toLowerCase().trim())
    );

    if (correct) {
      const userId = await ensureUser(interaction.user.id, interaction.user.username);
      await db.update(users).set({ gold: sql`${users.gold} + ${goldReward}` }).where(eq(users.id, userId));
      await setCooldown(interaction.user.id, "minigame");

      await correct.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setDescription(`✅ Correct! It was **${char.name}**!\n+💰 **${goldReward}** gold`)
        ],
      });
    } else {
      await setCooldown(interaction.user.id, "minigame");
      await interaction.followUp({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(`❌ Wrong! The answer was **${char.name}**.`)
        ],
      });
    }
  } catch {
    await setCooldown(interaction.user.id, "minigame");
    await interaction.followUp({
      embeds: [
        new EmbedBuilder()
          .setColor(0xe74c3c)
          .setDescription(`⏱️ Time's up! The answer was **${char.name}**.`)
      ],
    });
  }
}
