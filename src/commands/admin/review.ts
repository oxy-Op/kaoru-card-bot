import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";
import { getUserFlags, clearUserFlags } from "../../services/antibot.service.js";
import { config, isDevUser } from "../../config.js";

export const data = new SlashCommandBuilder()
  .setName("review")
  .setDescription("(Admin) Review anti-bot flags for a user")
  .addStringOption((o) => o.setName("userid").setDescription("Discord user ID to review").setRequired(true))
  .addBooleanOption((o) => o.setName("clear").setDescription("Clear all flags for this user"))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!config.ENABLE_PRIVATE_ADMIN_REVIEW) {
    await interaction.reply({
      content: "This command is disabled in open-source/public builds.",
      ephemeral: true,
    });
    return;
  }
  if (!isDevUser(interaction.user.id)) {
    await interaction.reply({ content: "Only bot admins can use this command.", ephemeral: true });
    return;
  }

  const targetId = interaction.options.getString("userid", true).trim();
  const shouldClear = interaction.options.getBoolean("clear") ?? false;

  if (shouldClear) {
    await clearUserFlags(targetId);
    await interaction.reply({ content: `Cleared all anti-bot flags for \`${targetId}\`.`, ephemeral: true });
    return;
  }

  const flags = await getUserFlags(targetId);

  const embed = new EmbedBuilder()
    .setColor(flags.locked ? 0xe74c3c : flags.count > 0 ? 0xf39c12 : 0x2ecc71)
    .setTitle(`Anti-Bot Review: ${targetId}`)
    .addFields(
      { name: "Status", value: flags.locked ? "🔒 LOCKED" : flags.count > 0 ? "⚠️ Flagged" : "✅ Clean", inline: true },
      { name: "Flag Count", value: `${flags.count}/5`, inline: true },
    )
    .setDescription(
      flags.reasons.length > 0
        ? "**Recent Flags:**\n" + flags.reasons.slice(-10).map((r) => `\`${r}\``).join("\n")
        : "No flags recorded."
    )
    .setFooter({ text: "Use /review userid:<id> clear:true to reset" });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
