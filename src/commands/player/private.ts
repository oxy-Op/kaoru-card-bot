import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

const TOGGLEABLE = ["collection", "inventory", "userinfo", "profile", "likes", "hexes", "auras", "stickers", "buffs"];

export const data = new SlashCommandBuilder()
  .setName("private")
  .setDescription("Toggle privacy for commands")
  .addStringOption((o) =>
    o.setName("field")
      .setDescription("Field to toggle (or 'all'/'none')")
      .addChoices(
        ...TOGGLEABLE.map((f) => ({ name: f, value: f })),
        { name: "all", value: "all" },
        { name: "none", value: "none" },
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const userId = await ensureUser(interaction.user.id, interaction.user.username);
  const field = interaction.options.getString("field");

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, interaction.user.id),
    columns: { privateFields: true },
  });

  let current: string[] = user?.privateFields ?? [];

  if (!field) {
    const lines = TOGGLEABLE.map((f) => {
      const isPrivate = current.includes(f);
      return `${isPrivate ? "🔒" : "🔓"} **${f}** · ${isPrivate ? "Private" : "Public"}`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setAuthor({ name: `${interaction.user.username}'s Privacy`, iconURL: interaction.user.displayAvatarURL() })
      .setDescription(lines.join("\n"))
      .setFooter({ text: "Use /private <field> to toggle" });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (field === "all") {
    current = [...TOGGLEABLE];
  } else if (field === "none") {
    current = [];
  } else if (current.includes(field)) {
    current = current.filter((f) => f !== field);
  } else {
    current.push(field);
  }

  await db.update(users).set({ privateFields: current }).where(eq(users.id, userId));

  const state = field === "all" ? "all fields set to private" :
    field === "none" ? "all fields set to public" :
    `**${field}** is now ${current.includes(field) ? "private 🔒" : "public 🔓"}`;

  await interaction.reply({ content: `Privacy updated: ${state}`, ephemeral: true });
}
