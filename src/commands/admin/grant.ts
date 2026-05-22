import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "../../db/index.js";
import { cards, characters, characterEditions, users } from "../../db/schema.js";
import { eq, sql, ilike } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";
import { newCardCode, rollQuality, rollPrintNumber } from "../../utils/codes.js";
import { isDevUser } from "../../config.js";

export const data = new SlashCommandBuilder()
  .setName("grant")
  .setDescription("(Admin) Grant a card to a user")
  .addStringOption((o) => o.setName("userid").setDescription("Recipient Discord user ID").setRequired(true))
  .addStringOption((o) => o.setName("character").setDescription("Character name").setRequired(true))
  .addStringOption((o) =>
    o.setName("quality").setDescription("Card quality").setRequired(false)
      .addChoices(
        { name: "Pristine", value: "pristine" },
        { name: "Excellent", value: "excellent" },
        { name: "Good", value: "good" },
        { name: "Poor", value: "poor" },
      )
  )
  .addIntegerOption((o) => o.setName("edition").setDescription("Edition number (default 1)").setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!isDevUser(interaction.user.id)) {
    await interaction.reply({ content: "Only bot admins can use this command.", ephemeral: true });
    return;
  }

  const targetId = interaction.options.getString("userid", true).trim();
  // Resolve username — try to fetch from Discord, fallback to ID
  let targetUsername = targetId;
  try {
    const user = await interaction.client.users.fetch(targetId);
    targetUsername = user.username;
  } catch {}

  const charName = interaction.options.getString("character", true);
  const quality = (interaction.options.getString("quality") ?? "pristine") as any;
  const edNum = interaction.options.getInteger("edition") ?? 1;

  // Find character
  const char = await db
    .select({ id: characters.id, name: characters.name, series: characters.series })
    .from(characters)
    .where(ilike(characters.name, `%${charName}%`))
    .orderBy(sql`${characters.popularity} DESC`)
    .limit(1);

  if (char.length === 0) {
    await interaction.reply({ content: `No character found matching "${charName}".`, ephemeral: true });
    return;
  }

  const character = char[0];

  // Find edition
  const [edition] = await db
    .select({
      id: characterEditions.id,
      editionNumber: characterEditions.editionNumber,
      maxPrints: characterEditions.maxPrints,
    })
    .from(characterEditions)
    .where(eq(characterEditions.characterId, character.id))
    .orderBy(sql`ABS(${characterEditions.editionNumber} - ${edNum})`)
    .limit(1);

  if (!edition) {
    await interaction.reply({ content: "No editions found for this character.", ephemeral: true });
    return;
  }

  const targetUserId = await ensureUser(targetId, targetUsername);
  const code = newCardCode();

  const useEditionId = edition.id;
  const useEditionNum = edition.editionNumber;

  // Get weighted random print for the chosen edition
  const existingPrints = await db
    .select({ printNumber: cards.printNumber })
    .from(cards)
    .where(eq(cards.editionId, useEditionId));
  const takenPrints = new Set(existingPrints.map((r) => r.printNumber));
  const printNumber = rollPrintNumber(takenPrints, edition.maxPrints ?? null);

  await db.insert(cards).values({
    code,
    characterId: character.id,
    editionId: useEditionId,
    printNumber,
    quality,
    originalQuality: quality,
    summonerId: targetUserId,
    ownerId: targetUserId,
    grabberId: targetUserId,
    grabbedAt: new Date(),
    guildId: interaction.guildId ?? "ADMIN",
    tag: "Admin Grant",
    tagEmoji: "🎁",
  });

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🎁 Admin Grant")
    .setDescription(
      `Granted **${character.name}** to <@${targetId}>\n\n` +
      `Code: \`${code}\`\n` +
      `Quality: **${quality}**\n` +
      `Edition: ◎${useEditionNum}\n` +
      `Print: #${printNumber}\n` +
      `Series: ${character.series}`
    );

  await interaction.reply({ embeds: [embed] });
}
