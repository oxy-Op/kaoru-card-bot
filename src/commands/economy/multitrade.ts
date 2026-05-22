import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
  type Message,
  type TextBasedChannel,
} from "discord.js";
import {
  createMultiTrade,
  getMultiTrade,
  addCardsToTrade,
  removeFromTrade,
  setTradeGold,
  lockTrade,
  executeMultiTrade,
  type TradeSession,
} from "../../services/trade.service.js";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("multitrade")
  .setDescription("Start a multi-card trade with another user")
  .addUserOption((opt) => opt.setName("user").setDescription("Who to trade with").setRequired(true));

const QUALITY_SHORT: Record<string, string> = {
  damaged: "dmg", poor: "poor", good: "good", excellent: "exc", pristine: "pris",
};

function formatCardLine(c: { code: string; charName: string; printNumber: number; quality: string }) {
  return `\`${c.code}\` ${c.charName} #${c.printNumber} *${QUALITY_SHORT[c.quality] ?? c.quality}*`;
}

function buildSideDisplay(cardList: TradeSession["initiatorCards"], gold: number): string {
  if (cardList.length === 0 && gold === 0) return "*No items added*";
  const lines: string[] = [];
  for (const c of cardList) {
    lines.push(formatCardLine(c));
  }
  if (gold > 0) lines.push(`+ **${gold.toLocaleString()}** gold`);
  return lines.join("\n");
}

function buildTradeEmbed(
  session: TradeSession,
  initiatorName: string,
  receiverName: string
): EmbedBuilder {
  const initLock = session.initiatorLocked ? " 🔒" : "";
  const recvLock = session.receiverLocked ? " 🔒" : "";

  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("Multitrade")
    .setDescription(
      "Type card codes to add. Separate with `,` for multiple.\n" +
      "Prefix with `-` to remove. Type `Ng` for gold (e.g. `500g`)."
    )
    .addFields(
      {
        name: `${initiatorName}${initLock}`,
        value: buildSideDisplay(session.initiatorCards, session.initiatorGold),
        inline: true,
      },
      {
        name: `${receiverName}${recvLock}`,
        value: buildSideDisplay(session.receiverCards, session.receiverGold),
        inline: true,
      },
    )
    .setFooter({ text: "Trade expires in 10 min" });
}

function buildTradeButtons(tradeId: string, session: TradeSession) {
  const bothLocked = session.initiatorLocked && session.receiverLocked;

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`mt_cancel:${tradeId}`)
      .setLabel("Cancel")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`mt_lock:${tradeId}`)
      .setLabel("Lock")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(bothLocked),
    new ButtonBuilder()
      .setCustomId(`mt_confirm:${tradeId}`)
      .setLabel("Confirm")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!bothLocked),
  );
}

export interface TradeInput {
  type: "add_cards" | "remove_card" | "set_gold" | "remove_gold";
  codes?: string[];
  gold?: number;
}

export function parseTradeInput(content: string): TradeInput[] {
  const results: TradeInput[] = [];
  const parts = content.split(",").map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    // Remove gold: -gold, -g
    if (/^-\s*gold$/i.test(part) || /^-\s*g$/i.test(part)) {
      results.push({ type: "remove_gold" });
      continue;
    }

    // Gold: 500g, 500 gold, 500gold
    const goldMatch = part.match(/^(\d+)\s*g(?:old)?$/i);
    if (goldMatch) {
      results.push({ type: "set_gold", gold: parseInt(goldMatch[1], 10) });
      continue;
    }

    // Remove card: -code
    const removeMatch = part.match(/^-\s*(\S+)$/);
    if (removeMatch) {
      results.push({ type: "remove_card", codes: [removeMatch[1]] });
      continue;
    }

    // Card code: anything that looks like a code (5-8 alphanumeric chars)
    if (/^[a-zA-Z0-9]{4,10}$/.test(part)) {
      results.push({ type: "add_cards", codes: [part] });
      continue;
    }
  }

  // Merge consecutive add_cards into one batch
  const merged: TradeInput[] = [];
  for (const r of results) {
    if (r.type === "add_cards" && merged.length > 0 && merged[merged.length - 1].type === "add_cards") {
      merged[merged.length - 1].codes!.push(...r.codes!);
    } else {
      merged.push(r);
    }
  }

  return merged;
}

async function runTradeSession(
  channel: TextBasedChannel,
  tradeId: string,
  initiatorId: string,
  initiatorName: string,
  receiverId: string,
  receiverName: string,
  tradeMsg: Message
) {
  const updateEmbed = async () => {
    const session = await getMultiTrade(tradeId);
    if (!session) return;
    const embed = buildTradeEmbed(session, initiatorName, receiverName);
    const buttons = buildTradeButtons(tradeId, session);
    try { await tradeMsg.edit({ embeds: [embed], components: [buttons] }); } catch {}
  };

  // Button collector
  const buttonCollector = tradeMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 600_000,
    filter: (i) => i.user.id === initiatorId || i.user.id === receiverId,
  });

  // Message collector for both participants
  const ch = channel as any;
  const msgCollector = ch.createMessageCollector({
    time: 600_000,
    filter: (m: Message) =>
      (m.author.id === initiatorId || m.author.id === receiverId) &&
      !m.author.bot,
  });

  let tradeEnded = false;
  const endTrade = () => {
    if (tradeEnded) return;
    tradeEnded = true;
    msgCollector.stop();
    buttonCollector.stop();
  };

  msgCollector.on("collect", async (msg: Message) => {
    if (tradeEnded) return;

    const session = await getMultiTrade(tradeId);
    if (!session) { endTrade(); return; }

    const inputs = parseTradeInput(msg.content);
    if (inputs.length === 0) return; // Not trade input, ignore

    // Auto-delete the user's message to keep channel clean
    try { await msg.delete(); } catch {}

    const feedback: string[] = [];

    for (const input of inputs) {
      switch (input.type) {
        case "add_cards": {
          const result = await addCardsToTrade(tradeId, msg.author.id, input.codes!);
          if (!result.success) {
            feedback.push(result.reason);
          } else {
            if (result.errors.length > 0) feedback.push(...result.errors);
          }
          break;
        }
        case "remove_card": {
          const result = await removeFromTrade(tradeId, msg.author.id, input.codes![0]);
          if (!result.success) feedback.push(result.reason);
          break;
        }
        case "set_gold": {
          const result = await setTradeGold(tradeId, msg.author.id, input.gold!);
          if (!result.success) feedback.push(result.reason);
          break;
        }
        case "remove_gold": {
          const result = await setTradeGold(tradeId, msg.author.id, 0);
          if (!result.success) feedback.push(result.reason);
          break;
        }
      }
    }

    // Send errors as ephemeral-like reply, auto-delete after 5s
    if (feedback.length > 0) {
      try {
        const errMsg = await ch.send({ content: feedback.join("\n") });
        setTimeout(() => { errMsg.delete().catch(() => {}); }, 5000);
      } catch {}
    }

    await updateEmbed();
  });

  buttonCollector.on("collect", async (btnInteraction) => {
    if (tradeEnded) return;

    const action = btnInteraction.customId.split(":")[0];
    const session = await getMultiTrade(tradeId);
    if (!session) {
      await btnInteraction.update({ content: "Trade expired.", embeds: [], components: [] });
      endTrade();
      return;
    }

    if (action === "mt_cancel") {
      await btnInteraction.update({
        content: `❌ Trade cancelled by **${btnInteraction.user.username}**.`,
        embeds: [],
        components: [],
      });
      endTrade();
      return;
    }

    if (action === "mt_lock") {
      const result = await lockTrade(tradeId, btnInteraction.user.id);
      if (!result.success) {
        await btnInteraction.reply({ content: result.reason, ephemeral: true });
        return;
      }
      const updated = (await getMultiTrade(tradeId))!;
      const embed = buildTradeEmbed(updated, initiatorName, receiverName);
      const buttons = buildTradeButtons(tradeId, updated);
      await btnInteraction.update({ embeds: [embed], components: [buttons] });
      return;
    }

    if (action === "mt_confirm") {
      if (btnInteraction.user.id !== initiatorId && btnInteraction.user.id !== receiverId) {
        await btnInteraction.reply({ content: "Not your trade.", ephemeral: true });
        return;
      }

      const result = await executeMultiTrade(tradeId);
      if (!result.success) {
        await btnInteraction.reply({ content: result.reason, ephemeral: true });
        return;
      }

      const finalSession = session;
      const initCards = finalSession.initiatorCards.map((c) => `\`${c.code}\``).join(", ") || "—";
      const recvCards = finalSession.receiverCards.map((c) => `\`${c.code}\``).join(", ") || "—";
      const initGold = finalSession.initiatorGold > 0 ? ` + ${finalSession.initiatorGold}g` : "";
      const recvGold = finalSession.receiverGold > 0 ? ` + ${finalSession.receiverGold}g` : "";

      const doneEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("Trade Complete")
        .addFields(
          { name: initiatorName, value: `${initCards}${initGold}`, inline: true },
          { name: receiverName, value: `${recvCards}${recvGold}`, inline: true },
        );

      await btnInteraction.update({ embeds: [doneEmbed], components: [] });
      endTrade();
      return;
    }
  });

  buttonCollector.on("end", async (_, reason) => {
    if (reason === "time" && !tradeEnded) {
      try { await tradeMsg.edit({ content: "⏰ Trade expired.", embeds: [], components: [] }); } catch {}
    }
    endTrade();
  });
}

// ─── Slash command entry ─────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction) {
  await ensureUser(interaction.user.id, interaction.user.username);

  const target = interaction.options.getUser("user", true);
  if (target.id === interaction.user.id) {
    await interaction.reply({ content: "Can't trade with yourself.", ephemeral: true });
    return;
  }
  if (target.bot) {
    await interaction.reply({ content: "Can't trade with bots.", ephemeral: true });
    return;
  }

  const tradeId = await createMultiTrade(interaction.user.id, target.id);
  const session = (await getMultiTrade(tradeId))!;

  const embed = buildTradeEmbed(session, interaction.user.username, target.username);
  const buttons = buildTradeButtons(tradeId, session);

  const tradeMsg = await interaction.reply({
    content: `<@${target.id}>, **${interaction.user.username}** wants to trade with you!`,
    embeds: [embed],
    components: [buttons],
    fetchReply: true,
  });

  await runTradeSession(
    interaction.channel! as TextBasedChannel,
    tradeId,
    interaction.user.id,
    interaction.user.username,
    target.id,
    target.username,
    tradeMsg
  );
}

// ─── Prefix command entry: ka!mt @user ───────────────────

export async function executePrefixMultitrade(message: Message) {
  await ensureUser(message.author.id, message.author.username);

  const target = message.mentions.users.first();
  if (!target) {
    await message.reply("Usage: `ka!mt @user`");
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

  const tradeId = await createMultiTrade(message.author.id, target.id);
  const session = (await getMultiTrade(tradeId))!;

  const embed = buildTradeEmbed(session, message.author.username, target.username);
  const buttons = buildTradeButtons(tradeId, session);

  const tradeMsg = await message.reply({
    content: `<@${target.id}>, **${message.author.username}** wants to trade with you!`,
    embeds: [embed],
    components: [buttons],
  });

  await runTradeSession(
    message.channel as TextBasedChannel,
    tradeId,
    message.author.id,
    message.author.username,
    target.id,
    target.username,
    tradeMsg
  );
}
