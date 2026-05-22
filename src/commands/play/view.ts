import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getCardByCode } from "../../services/card.service.js";
import { renderCard, loadCharacterImage } from "../../image/renderer.js";
import { buildCardEmbed } from "../../utils/embeds.js";
import { readFile } from "fs/promises";
import { join } from "path";

export const data = new SlashCommandBuilder()
  .setName("view")
  .setDescription("View a card by its code")
  .addStringOption((opt) =>
    opt.setName("code").setDescription("The card code").setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const code = interaction.options.getString("code", true).trim();
  await interaction.deferReply();

  const card = await getCardByCode(code);
  if (!card) {
    await interaction.editReply(`No card found with code \`${code}\`.`);
    return;
  }

  try {
    const imageBuffer = await loadCharacterImage(card.edition.imagePath);
    let frameBuffer: Buffer | undefined;
    if (card.frameImagePath) {
      const candidatePaths = [
        card.frameImagePath,
        join(process.cwd(), card.frameImagePath),
        join(process.cwd(), "assets", card.frameImagePath),
      ];
      for (const p of candidatePaths) {
        try {
          frameBuffer = await readFile(p);
          break;
        } catch {
          // try next candidate
        }
      }
    }
    const cardImage = await renderCard({
      cardCode: card.code,
      characterImage: imageBuffer,
      name: card.character.name,
      series: card.character.series,
      quality: card.quality,
      printNumber: card.printNumber,
      editionNumber: card.edition.editionNumber,
      frame: frameBuffer,
      tag: card.tag ?? undefined,
      tagEmoji: card.tagEmoji ?? undefined,
    });

    const { embed, attachment } = buildCardEmbed({
      code: card.code,
      characterName: card.character.name,
      series: card.character.series,
      quality: card.quality,
      printNumber: card.printNumber,
      editionNumber: card.edition.editionNumber,
      imageBuffer: cardImage,
      tag: card.tag ?? undefined,
      tagEmoji: card.tagEmoji ?? undefined,
    });

    await interaction.editReply({ embeds: [embed], files: [attachment] });
  } catch {
    await interaction.editReply("Failed to render card image.");
  }
}
