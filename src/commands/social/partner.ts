import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("partner")
  .setDescription("Partner up with another user")
  .addUserOption((opt) => opt.setName("user").setDescription("Who to partner with").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("user", true);

  if (target.id === interaction.user.id) {
    await interaction.reply({ content: "You can't partner with yourself!", ephemeral: true });
    return;
  }

  const userId = await ensureUser(interaction.user.id, interaction.user.username);
  const targetId = await ensureUser(target.id, target.username);

  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { partnerId: true } });
  if (user?.partnerId) {
    await interaction.reply({ content: "You already have a partner! Use `/divorce` first.", ephemeral: true });
    return;
  }

  const targetUser = await db.query.users.findFirst({ where: eq(users.id, targetId), columns: { partnerId: true } });
  if (targetUser?.partnerId) {
    await interaction.reply({ content: "They already have a partner!", ephemeral: true });
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`partner_accept:${userId}:${targetId}`).setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`partner_reject:${userId}:${targetId}`).setLabel("Decline").setStyle(ButtonStyle.Danger),
  );

  await interaction.reply({
    content: `💕 **${interaction.user.username}** wants to partner with **${target.username}**! (expires in 10 minutes)`,
    components: [row],
  });
}
