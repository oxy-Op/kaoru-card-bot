import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { ensureUser } from "../../services/summon.service.js";
import {
  getInbox,
  readMail,
  markAllRead,
  deleteMail,
} from "../../services/mail.service.js";

const CATEGORY_EMOJI: Record<string, string> = {
  system: "⚙️",
  gift: "🎁",
  trade: "🤝",
  event: "🎪",
  achievement: "🏆",
};

function categoryEmoji(category: string): string {
  return CATEGORY_EMOJI[category] ?? "📧";
}

function categoryLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export const data = new SlashCommandBuilder()
  .setName("mail")
  .setDescription("Check your inbox")
  .addSubcommand((sub) =>
    sub
      .setName("inbox")
      .setDescription("View your inbox")
      .addIntegerOption((o) => o.setName("page").setDescription("Page number").setMinValue(1))
  )
  .addSubcommand((sub) =>
    sub
      .setName("read")
      .setDescription("Read a message")
      .addIntegerOption((o) => o.setName("id").setDescription("Message ID").setRequired(true).setMinValue(1))
  )
  .addSubcommand((sub) => sub.setName("clear").setDescription("Mark all messages as read"))
  .addSubcommand((sub) =>
    sub
      .setName("delete")
      .setDescription("Delete a message")
      .addIntegerOption((o) => o.setName("id").setDescription("Message ID").setRequired(true).setMinValue(1))
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await ensureUser(interaction.user.id, interaction.user.username);

  const sub = interaction.options.getSubcommand(true);

  if (sub === "inbox") {
    const pageOpt = interaction.options.getInteger("page");
    const page = pageOpt ?? 1;
    const { messages, total, unread, page: resolvedPage, totalPages } = await getInbox(
      interaction.user.id,
      page,
      10
    );

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📬 Inbox · ${unread} unread · ${total} total`);

    if (messages.length === 0) {
      embed.setDescription("*Your inbox is empty.*");
    } else {
      const lines = messages.map((m) => {
        const open = m.read ? "📭" : "📬";
        const cat = categoryEmoji(m.category);
        const t = Math.floor(m.createdAt.getTime() / 1000);
        return `${open} ${cat} **${m.subject}** · ID:${m.id} · <t:${t}:R>`;
      });
      embed.setDescription(lines.join("\n"));
      embed.setFooter({ text: `Page ${resolvedPage}/${totalPages}` });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === "read") {
    const id = interaction.options.getInteger("id", true);
    const message = await readMail(interaction.user.id, id);
    if (!message) {
      await interaction.reply({ content: "No message found with that ID.", ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(message.subject)
      .setDescription(message.body)
      .addFields({
        name: "Category",
        value: `${categoryEmoji(message.category)} ${categoryLabel(message.category)}`,
        inline: true,
      })
      .setFooter({ text: `ID ${message.id}` })
      .setTimestamp(message.createdAt);

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === "clear") {
    const n = await markAllRead(interaction.user.id);
    await interaction.reply({
      content: n === 0 ? "No unread messages." : `Marked **${n}** message(s) as read.`,
      ephemeral: true,
    });
    return;
  }

  if (sub === "delete") {
    const id = interaction.options.getInteger("id", true);
    const ok = await deleteMail(interaction.user.id, id);
    await interaction.reply({
      content: ok ? "Message deleted." : "No message found with that ID.",
      ephemeral: true,
    });
  }
}
