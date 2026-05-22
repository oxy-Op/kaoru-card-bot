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

const CHOICES = ["rock", "paper", "scissors"] as const;
const EMOJI: Record<string, string> = { rock: "🪨", paper: "📄", scissors: "✂️" };
const GOLD_WIN = 15;
const GOLD_TIE = 5;

export const data = new SlashCommandBuilder()
  .setName("rps")
  .setDescription("Play Rock-Paper-Scissors against Kaoru!");

export async function execute(interaction: ChatInputCommandInteraction) {
  const remaining = await getCooldown(interaction.user.id, "minigame");
  if (remaining > 0) {
    await interaction.reply({ content: `Minigame on cooldown! Ready <t:${Math.floor(Date.now() / 1000) + remaining}:R>`, ephemeral: true });
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("rps:rock").setLabel("Rock").setEmoji("🪨").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("rps:paper").setLabel("Paper").setEmoji("📄").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("rps:scissors").setLabel("Scissors").setEmoji("✂️").setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("✊ Rock Paper Scissors")
    .setDescription("Choose your move!");

  const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === interaction.user.id,
    time: 15_000,
    max: 1,
  });

  collector.on("collect", async (i) => {
    const playerChoice = i.customId.split(":")[1] as typeof CHOICES[number];
    const botChoice = CHOICES[Math.floor(Math.random() * 3)];

    let result: "win" | "lose" | "tie";
    if (playerChoice === botChoice) result = "tie";
    else if (
      (playerChoice === "rock" && botChoice === "scissors") ||
      (playerChoice === "paper" && botChoice === "rock") ||
      (playerChoice === "scissors" && botChoice === "paper")
    ) result = "win";
    else result = "lose";

    const userId = await ensureUser(interaction.user.id, interaction.user.username);
    let goldEarned = 0;

    if (result === "win") goldEarned = GOLD_WIN;
    else if (result === "tie") goldEarned = GOLD_TIE;

    if (goldEarned > 0) {
      await db.update(users).set({ gold: sql`${users.gold} + ${goldEarned}` }).where(eq(users.id, userId));
    }

    await setCooldown(interaction.user.id, "minigame");

    const resultEmoji = result === "win" ? "🎉" : result === "tie" ? "🤝" : "💀";
    const resultText = result === "win" ? "You win!" : result === "tie" ? "It's a tie!" : "You lose!";

    await i.update({
      embeds: [
        new EmbedBuilder()
          .setColor(result === "win" ? 0x2ecc71 : result === "tie" ? 0xf39c12 : 0xe74c3c)
          .setTitle(`${resultEmoji} ${resultText}`)
          .setDescription(
            `You: ${EMOJI[playerChoice]} · Kaoru: ${EMOJI[botChoice]}\n\n` +
            (goldEarned > 0 ? `+💰 **${goldEarned}** gold` : "Better luck next time!")
          )
      ],
      components: [],
    });
  });

  collector.on("end", async (collected) => {
    if (collected.size === 0) {
      await msg.edit({ content: "RPS timed out.", embeds: [], components: [] }).catch(() => {});
    }
  });
}
