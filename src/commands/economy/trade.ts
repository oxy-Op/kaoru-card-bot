import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import { quickTrade } from "../../services/trade.service.js";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("trade")
  .setDescription("Quick 1:1 card trade with another user")
  .addUserOption((opt) => opt.setName("user").setDescription("Who to trade with").setRequired(true))
  .addStringOption((opt) => opt.setName("your_card").setDescription("Your card code").setRequired(true))
  .addStringOption((opt) => opt.setName("their_card").setDescription("Their card code").setRequired(true));

const QUICK_TRADE_TIMEOUT_MS = 60_000;

function buildConsentButtons(token: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`trade_accept:${token}`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`trade_decline:${token}`)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Danger)
  );
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await ensureUser(interaction.user.id, interaction.user.username);

  const target = interaction.options.getUser("user", true);
  const yourCard = interaction.options.getString("your_card", true).trim();
  const theirCard = interaction.options.getString("their_card", true).trim();

  if (target.id === interaction.user.id) {
    await interaction.reply({ content: "Can't trade with yourself.", ephemeral: true });
    return;
  }
  if (target.bot) {
    await interaction.reply({ content: "Can't trade with bots.", ephemeral: true });
    return;
  }

  const token = `${interaction.id}:${Date.now()}`;
  const consentButtons = buildConsentButtons(token);
  const prompt = await interaction.reply({
    content:
      `<@${target.id}>, quick trade request from **${interaction.user.username}**.\n` +
      `Offer: \`${yourCard}\` ↔ \`${theirCard}\`\n` +
      `You must accept for this trade to execute.`,
    components: [consentButtons],
    fetchReply: true,
  });

  let resolved = false;
  const collector = prompt.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: QUICK_TRADE_TIMEOUT_MS,
    filter: (btn) => btn.customId.endsWith(token),
  });

  collector.on("collect", async (btn) => {
    if (resolved) return;
    if (btn.user.id !== target.id) {
      await btn.reply({ content: "Only the requested user can approve this trade.", ephemeral: true });
      return;
    }

    if (btn.customId.startsWith("trade_decline:")) {
      resolved = true;
      collector.stop("declined");
      await btn.update({
        content: `❌ Trade declined by **${target.username}**.`,
        components: [],
      });
      return;
    }

    const result = await quickTrade(
      interaction.user.id, interaction.user.username,
      target.id, target.username,
      yourCard, theirCard
    );

    resolved = true;
    collector.stop(result.success ? "accepted" : "failed");
    if (!result.success) {
      await btn.update({
        content: `❌ Trade failed: ${result.reason}`,
        components: [],
      });
      return;
    }

    await btn.update({
      content: `🔄 Trade complete! **${interaction.user.username}** (\`${yourCard}\`) ↔ **${target.username}** (\`${theirCard}\`)`,
      components: [],
    });
  });

  collector.on("end", async (_collected, reason) => {
    if (resolved) return;
    if (reason === "time") {
      await interaction.editReply({
        content: "⏰ Trade request expired (no consent received).",
        components: [],
      }).catch(() => {});
    }
  });
}

export async function executePrefix(message: Message, args: string[]) {
  await ensureUser(message.author.id, message.author.username);

  const target = message.mentions.users.first();
  const codes = args.filter((a) => !a.startsWith("<@"));
  if (!target || codes.length < 2) {
    await message.reply("Usage: `ka!trade <@user> <your code> <their code>`");
    return;
  }
  if (target.id === message.author.id) {
    await message.reply("Can't trade with yourself.");
    return;
  }
  if (target.bot) {
    await message.reply("Can't trade with bots.");
    return;
  }

  const yourCard = codes[0].trim();
  const theirCard = codes[1].trim();
  const token = `${message.id}:${Date.now()}`;
  const consentButtons = buildConsentButtons(token);

  const prompt = await message.reply({
    content:
      `<@${target.id}>, quick trade request from **${message.author.username}**.\n` +
      `Offer: \`${yourCard}\` ↔ \`${theirCard}\`\n` +
      `You must accept for this trade to execute.`,
    components: [consentButtons],
  });

  let resolved = false;
  const collector = prompt.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: QUICK_TRADE_TIMEOUT_MS,
    filter: (btn) => btn.customId.endsWith(token),
  });

  collector.on("collect", async (btn) => {
    if (resolved) return;
    if (btn.user.id !== target.id) {
      await btn.reply({ content: "Only the requested user can approve this trade.", ephemeral: true });
      return;
    }

    if (btn.customId.startsWith("trade_decline:")) {
      resolved = true;
      collector.stop("declined");
      await btn.update({
        content: `❌ Trade declined by **${target.username}**.`,
        components: [],
      });
      return;
    }

    const result = await quickTrade(
      message.author.id, message.author.username,
      target.id, target.username,
      yourCard, theirCard
    );

    resolved = true;
    collector.stop(result.success ? "accepted" : "failed");
    if (!result.success) {
      await btn.update({
        content: `❌ Trade failed: ${result.reason}`,
        components: [],
      });
      return;
    }

    await btn.update({
      content: `🔄 Trade complete! **${message.author.username}** (\`${yourCard}\`) ↔ **${target.username}** (\`${theirCard}\`)`,
      components: [],
    });
  });

  collector.on("end", async (_collected, reason) => {
    if (resolved) return;
    if (reason === "time") {
      await prompt.edit({
        content: "⏰ Trade request expired (no consent received).",
        components: [],
      }).catch(() => {});
    }
  });
}
