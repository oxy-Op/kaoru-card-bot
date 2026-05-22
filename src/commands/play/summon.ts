import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type Message as DiscordMessage,
} from "discord.js";
import {
  performSummon,
  getSummonSession,
  SummonCooldownError,
} from "../../services/summon.service.js";
import {
  renderSummonCard,
  renderMysteryCard,
  renderSummonImage,
  loadCharacterImage,
} from "../../image/renderer.js";
import { buildSummonMessage } from "../../utils/embeds.js";
import { formatCooldown } from "../../services/cooldown.service.js";

const SUMMON_EXPIRY_MS = 60_000;

export const data = new SlashCommandBuilder()
  .setName("summon")
  .setDescription("Summon 3 random anime character cards!");

async function doSummon(
  userId: string,
  username: string,
  guildId: string,
  isActivity = false
) {
  const result = await performSummon({
    discordUserId: userId,
    username,
    guildDiscordId: guildId,
    isActivitySpawn: isActivity,
  });

  // Render compact cards 1 & 2 (with fallback for missing images)
  const [card1Img, card2Img] = await Promise.all(
    result.cards.slice(0, 2).map(async (c) => {
      try {
        const charImg = await loadCharacterImage(
          c.edition.imagePath,
          c.character.imageUrl
        );
        return renderSummonCard({
          cardCode: c.code,
          frameStyle: c.frameStyle,
          characterImage: charImg,
          name: c.character.name,
          series: c.character.series,
          quality: c.quality,
          printNumber: c.printNumber,
          editionNumber: c.edition.editionNumber,
        });
      } catch {
        // Fallback: render card with placeholder if image missing
        const placeholder = Buffer.alloc(100);
        return renderSummonCard({
          cardCode: c.code,
          frameStyle: c.frameStyle,
          characterImage: placeholder,
          name: c.character.name,
          series: c.character.series,
          quality: c.quality,
          printNumber: c.printNumber,
          editionNumber: c.edition.editionNumber,
        });
      }
    })
  );

  // Mystery card (slot 3)
  const mysteryImg = await renderMysteryCard();

  const combinedImage = await renderSummonImage(card1Img, card2Img, mysteryImg);

  const { content, attachment, row } = buildSummonMessage({
    summonId: result.summonId,
    summonerName: userId,
    cardCount: 2,
    imageBuffer: combinedImage,
    isActivitySpawn: isActivity,
  });

  return { content, attachment, row, result };
}

function scheduleExpiry(
  summonId: string,
  editMessage: (opts: object) => Promise<unknown>
) {
  setTimeout(async () => {
    try {
      const session = await getSummonSession(summonId);
      const allGrabbed = session?.grabbed?.every(Boolean) ?? false;

      if (!session || !allGrabbed) {
        const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`expired:${summonId}:0`)
            .setLabel("1")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId(`expired:${summonId}:1`)
            .setLabel("2")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId(`expired:${summonId}:2`)
            .setLabel("?")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
        );

        await editMessage({
          content: "*These card summons have expired and can no longer be grabbed.*",
          embeds: [],
          components: [disabledRow],
        });
      }
    } catch {
      // Message deleted or bot lacks permissions
    }
  }, SUMMON_EXPIRY_MS);
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use this in a server!", ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    const { content, attachment, row, result } = await doSummon(
      interaction.user.id,
      interaction.user.username,
      interaction.guild.id
    );

    await interaction.editReply({
      content,
      files: [attachment],
      components: [row],
    });

    scheduleExpiry(result.summonId, (opts) =>
      interaction.editReply(opts as any)
    );
  } catch (err) {
    if (err instanceof SummonCooldownError) {
      await interaction.editReply(
        `You're on cooldown! Ready <t:${Math.floor(Date.now() / 1000) + err.remaining}:R>`
      );
      return;
    }
    console.error("[Summon] Error:", err);
    await interaction.editReply("Something went wrong while summoning. Try again!");
  }
}

export async function executePrefix(message: DiscordMessage) {
  if (!message.guild) return;

  try {
    const { content, attachment, row, result } = await doSummon(
      message.author.id,
      message.author.username,
      message.guild.id
    );

    const sent = await message.reply({
      content,
      files: [attachment],
      components: [row],
    });

    scheduleExpiry(result.summonId, (opts) => sent.edit(opts as any));
  } catch (err) {
    if (err instanceof SummonCooldownError) {
      await message.reply(
        `You're on cooldown! Ready <t:${Math.floor(Date.now() / 1000) + err.remaining}:R>`
      );
      return;
    }
    console.error("[Summon] Error:", err);
    await message.reply("Something went wrong while summoning. Try again!");
  }
}

/** Activity spawn: bot-initiated summon in a channel. No specific summoner. */
export async function executeActivitySpawn(message: DiscordMessage, guildId: string) {
  try {
    const { content, attachment, row, result } = await doSummon(
      message.client.user!.id,
      "Activity Spawn",
      guildId,
      true
    );

    const sent = await (message.channel as any).send({
      content,
      files: [attachment],
      components: [row],
    });

    scheduleExpiry(result.summonId, (opts) => sent.edit(opts as any));
    console.log(`[Activity] Spawned ${result.summonId} in ${guildId}/${message.channel.id}`);
  } catch (err) {
    console.error("[Activity] Spawn failed:", err);
  }
}
