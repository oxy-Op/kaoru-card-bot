import { type Message, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from "discord.js";
import { db } from "../db/index.js";
import { guilds, cards, characters, characterEditions, users } from "../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { trackActivity } from "../cache/activity.js";
import { redis } from "../cache/index.js";
import { config } from "../config.js";
import { prefixAliases } from "../commands/index.js";
import { executePrefix as summonPrefix, executeActivitySpawn } from "../commands/play/summon.js";
import { getCardByCode, getUserCollection, searchCharacters, getWishlistCount, parseCollectionArgs } from "../services/card.service.js";
import { getBalance } from "../services/economy.service.js";
import { getAllCooldowns } from "../services/cooldown.service.js";
import { buildCooldownEmbed, formatGrabLine } from "../utils/embeds.js";
import { renderCard, loadCharacterImage } from "../image/renderer.js";
import { ensureUser } from "../services/summon.service.js";
import { qualityStars, formatPrint, formatEdition } from "../utils/codes.js";
import { getAchievements, claimReward } from "../services/achievement.service.js";
import { checkAntiBot } from "../services/antibot.service.js";
import {
  bidAuction,
  cancelAuction,
  createAuction,
  listActiveAuctions,
  settleAuction,
} from "../services/auction.service.js";
import { readFile } from "fs/promises";
import { join } from "path";

export async function handleMessage(message: Message) {
  if (message.author.bot || !message.guild) return;

  const guildId = message.guild.id;
  const channelId = message.channel.id;
  const userId = message.author.id;

  // Anti-bot: track message entropy for activity spam detection
  checkAntiBot(userId, "__activity_msg", message.content).catch(() => {});

  // Track activity for potential activity spawns
  const [guildConfig] = await db
    .select()
    .from(guilds)
    .where(eq(guilds.discordId, guildId))
    .limit(1);

  const threshold =
    guildConfig?.activityThreshold ?? config.ACTIVITY_SPAWN_THRESHOLD;
  const shouldSpawn = await trackActivity(
    guildId,
    channelId,
    userId,
    threshold
  );

  if (shouldSpawn) {
    // Check setchannel — only spawn in summon channel if configured
    const spawnChannel = guildConfig?.summonChannelId;
    const restricted = (guildConfig?.restrictedChannels ?? {}) as Record<string, string[]>;
    const playRestricted = restricted["play"];

    // Only spawn if: no setchannel OR this is the summon channel
    // AND: no play restriction OR this channel is allowed for play
    const channelAllowed =
      (!spawnChannel || spawnChannel === channelId) &&
      (!playRestricted?.length || playRestricted.includes(channelId));

    if (channelAllowed) {
      console.log(`[Activity] Spawn in ${guildId}/${channelId}`);
      try {
        await executeActivitySpawn(message, guildId);
      } catch (err) {
        console.error("[Activity] Spawn error:", err);
      }
    }
  }

  // Handle prefix commands (case-insensitive)
  const prefix = guildConfig?.prefix ?? config.DEFAULT_PREFIX;
  if (!message.content.toLowerCase().startsWith(prefix.toLowerCase())) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();

  if (!command) return;

  // Help command
  if (command === "help" || command === "h") {
    const p = prefix;

    const helpDetail: Record<string, { desc: string; usage: string; aliases?: string }> = {
      // Play
      summon:      { desc: "Summon 3 cards — 2 revealed + 1 mystery. One player grabs per summon.", usage: `${p}s`, aliases: "s" },
      view:        { desc: "View your last grabbed card, or a specific card by code. Mention a user to see theirs.", usage: `${p}v [code | @user]`, aliases: "v" },
      collection:  { desc: "Browse your collection. Filter: `o=print` `q=4` `n>5` `t=fav` `s=naruto` `c=goku` `hex=1`\nSort: `o=print/quality/name/series/newest/oldest`", usage: `${p}c [filters] [page | @user]`, aliases: "c, col" },
      lookup:      { desc: "Search characters by name or series.\n`s:naruto` — filter by series\n`c:sasuke` — filter by character\n`s:naruto c:sasuke` — both\nNo args shows default top character list.", usage: `${p}lu [name]`, aliases: "lu, li" },
      cardinfo:    { desc: "View detailed card info: quality, owner, summoner, print number, tag, cosmetics, and wishlist count.", usage: `${p}ci <code>`, aliases: "ci" },
      seriescompletion: { desc: "Track your collection progress for a series. Shows owned vs total characters.", usage: `${p}sc <series name>`, aliases: "sc" },
      favorite:    { desc: "Set or view your favorite card. Shown on your profile.\n`fav clear` — remove\n`fav` — show current", usage: `${p}fav <code>`, aliases: "fav" },
      cooldown:    { desc: "Check all your active cooldown timers (summon, grab, daily, vote, minigame).", usage: `${p}cd`, aliases: "cd" },
      alarm:       { desc: "Set DM reminders for when cooldowns expire.\n`/alarm show` — view status\n`/alarm set <type>` — enable for a cooldown\n`/alarm off <type>` — disable\n`/alarm all` — enable all\n`/alarm clear` — disable all", usage: `/alarm show` },
      // Economy
      daily:       { desc: "Claim your daily gold reward (1-100 gold). 20-hour cooldown.", usage: `${p}daily` },
      balance:     { desc: "Check your gold, petals, cinders, and shards.", usage: `${p}bal`, aliases: "bal" },
      give:        { desc: "Give a card to another player.", usage: `${p}give <@user> <code>` },
      trade:       { desc: "Quick 1:1 card trade with another player.", usage: `${p}trade <@user> <your code> <their code>` },
      multitrade:  { desc: "Interactive multi-card trade. Both users type card codes directly in chat.\nSeparate with commas for multiple. Type `500g` for gold. Prefix with `-` to remove.\nBoth sides lock, then confirm to execute.", usage: `${p}mt <@user>`, aliases: "mt" },
      shop:        { desc: "Browse the shop. Shows all available items with prices.\nUse `buy` to purchase items.", usage: `${p}shop` },
      buy:         { desc: "Buy an item from the shop by name or ID.\nSupports quantity for bulk purchases.", usage: `${p}buy <item name or id> [quantity]` },
      vote:        { desc: "Vote rewards (gold + shards) when vote verification is enabled by the host.", usage: `/vote` },
      openpack:    { desc: "Open a card pack.\n**Standard** — 300 gold (3 random cards)\n**Premium** — 25 shards\n**Legendary** — 100 shards", usage: `/openpack <type>`, aliases: "pack" },
      upgrade:     { desc: "Upgrade a card's quality using Cinders.\nDamaged→Poor: 10 | Poor→Good: 25 | Good→Excellent: 75 | Excellent→Pristine: 200", usage: `${p}upgrade <code>` },
      burn:        { desc: "Destroy a card permanently to earn Cinders. Higher quality = more cinders.", usage: `/burn <code>` },
      buff:        { desc: "View and buy timed buffs.\n`buff buy <id>` — purchase a buff\n`buff` — view active and available buffs", usage: `${p}buff [buy <id>]`, aliases: "buffs" },
      potion:      { desc: "Buy and use consumable potions.\n`potion buy <id> [qty]` — purchase\n`potion use <id> [args]` — use a potion\n`potion` — view inventory + shop", usage: `${p}potion [buy|use] <id>`, aliases: "potions, pot" },
      slu:         { desc: "Upgrade your summon list capacity. Costs gold, increases by 1 slot.", usage: `${p}slu`, aliases: "summonlistupgrade" },
      lsu:         { desc: "Upgrade your like list capacity. Costs gold, increases by 1 slot.", usage: `${p}lsu`, aliases: "llu, likelistupgrade" },
      // Fusion
      fusionboard: { desc: "View your fusion board — cards queued for fusing.", usage: `${p}fb`, aliases: "fb" },
      fuseadd:     { desc: "Add one or more cards to your fusion pile. Comma or space separated.", usage: `${p}fa <code> [code] [code]`, aliases: "fa" },
      fuse:        { desc: "Fuse all cards on your board. Earns gold + cinders. Need 3+ cards.", usage: `${p}f`, aliases: "f" },
      fastfuse:    { desc: "Add cards and immediately fuse in one command.", usage: `${p}ff <code> <code> <code>`, aliases: "ff" },
      // Tags
      tag:         { desc: "Set or remove a tag on a card. Tags help organize your collection.", usage: `${p}tag <code> [text]` },
      tagadd:      { desc: "Create a named tag with a custom emoji.", usage: `/tagadd <name> <emoji>`, aliases: "ta" },
      tagremove:   { desc: "Delete a tag definition. Removes from all cards using it.", usage: `/tagremove <name>`, aliases: "tr" },
      tagrename:   { desc: "Rename an existing tag. All cards with the old tag are updated.", usage: `/tagrename <old name> <new name>` },
      tagreemote:  { desc: "Change the emoji on an existing tag.", usage: `/tagreemote <name> <new emoji>` },
      untag:       { desc: "Remove the tag from a specific card.", usage: `/untag <code>`, aliases: "ut" },
      taglist:     { desc: "List all your tags with card counts and emojis.", usage: `/taglist`, aliases: "tl, tags" },
      // Albums
      albums:      { desc: "View your (or another user's) albums.", usage: `${p}albums [@user]` },
      album:       { desc: "View an album page. Cards displayed with quality, print, edition.", usage: `${p}alb <name> [page]`, aliases: "alb" },
      albumadd:    { desc: "Create a new album. Starts with 1 page.", usage: `${p}aa <name>`, aliases: "aa, albumcreate" },
      albumremove: { desc: "Delete an album and all its pages/cards.", usage: `${p}alr <name>`, aliases: "alr" },
      renamealbum: { desc: "Rename an album.", usage: `${p}ar <old>, <new>`, aliases: "ar" },
      pageadd:     { desc: "Add a new page to an album.", usage: `${p}pa <album name>`, aliases: "pa" },
      albumpageremove: { desc: "Remove a page from an album (renumbers remaining).", usage: `${p}apr <album name> <page#>`, aliases: "apr" },
      albumcard:   { desc: "Place a card on an album page. Position 1-8 (decimals ok).", usage: `${p}albc <album> <page> <pos> <code>`, aliases: "albc" },
      albumcardremove: { desc: "Remove a card from an album.", usage: `${p}acr <album> <code>`, aliases: "acr" },
      albumbackground: { desc: "Set background for album page. Use `all` for entire album.", usage: `${p}ab <album> <page|all> <bg id>`, aliases: "ab" },
      albumpageswap: { desc: "Swap two pages within an album.", usage: `${p}aps <album> <page1> <page2>`, aliases: "aps" },
      // Cosmetics
      framepreview:{ desc: "Preview how a frame looks on your card without equipping it.", usage: `${p}fp <card code> <frame name or id>`, aliases: "fp" },
      use:         { desc: "Apply a cosmetic (frame, hex, or aura) to one of your cards.", usage: `/use <frame|hex|aura> <item id> <card code>` },
      removehex:   { desc: "Remove a hex from a card. The hex returns to your inventory.", usage: `/removehex <card code>` },
      removeaura:  { desc: "Remove an aura from a card. The aura returns to your inventory.", usage: `/removeaura <card code>` },
      removeframe: { desc: "Remove a frame from a card. The frame returns to your inventory.", usage: `/removeframe <card code>` },
      spell:       { desc: "Apply, remove, or browse text effects for your cards.\n`/spell list` — see available spells\n`/spell apply <card> <spell>` — apply\n`/spell remove <card>` — remove", usage: `/spell list|apply|remove` },
      stick:       { desc: "Place a sticker on a card at a position (1-19). Omit sticker id to remove.", usage: `/stick <code> <position> [sticker id]` },
      cosmetics:   { desc: "View your cosmetic inventory — hexes, auras, frames, and stickers.", usage: `/cosmetics` },
      open:        { desc: "Open a cosmetic pack.\n**Hex Pack** — 200 gold (1-3 hexes)\n**Sticker Pack** — 150 gold (1-3 stickers)", usage: `/open <hex|sticker>` },
      // RPG
      teams:       { desc: "View your teams and their status.", usage: `${p}ts`, aliases: "ts" },
      team:        { desc: "View detailed team info — members, stats, gear.", usage: `${p}team <name>` },
      addteam:     { desc: "Create a new questing team.", usage: `${p}at <name>`, aliases: "at" },
      deleteteam:  { desc: "Delete a team (can't delete questing teams).", usage: `${p}dt <name>`, aliases: "dt" },
      renameteam:  { desc: "Rename a team.", usage: `${p}rt <old>, <new>`, aliases: "rt" },
      addmember:   { desc: "Add a card to a team.", usage: `${p}am <team> <code> [slot]`, aliases: "am" },
      removemember:{ desc: "Remove a card from a team.", usage: `${p}rm <team> <code>`, aliases: "rm" },
      cardstats:   { desc: "View a card's RPG stats (ATK/DEF/SPD/HP/LUK), level, and XP.", usage: `${p}stats <code>`, aliases: "stats" },
      questlist:   { desc: "Browse available quests with difficulty, rewards, requirements.", usage: `${p}ql`, aliases: "ql" },
      questinfo:   { desc: "View detailed info about a specific quest.", usage: `${p}qi <quest id>`, aliases: "qi" },
      quest:       { desc: "Send a team on a quest. Shows success chance before starting.", usage: `${p}q <quest id> <team name>`, aliases: "q" },
      quests:      { desc: "View your active quests and time remaining.", usage: `${p}qs`, aliases: "qs" },
      completequest:{ desc: "Complete a finished quest and claim rewards.", usage: `${p}cq <team name>`, aliases: "cq" },
      questreturn: { desc: "Cancel a quest and bring the team home (no rewards).", usage: `${p}qr <team name>`, aliases: "qr" },
      // Profile
      profile:     { desc: "View your or another player's profile — level, stats, economy, partner.", usage: `${p}p [@user]`, aliases: "p" },
      blurb:       { desc: "Set your profile blurb text (max 200 characters).", usage: `${p}blurb <text>` },
      profileset:  { desc: "Customize your profile — colors, opacity, progress bar, and more.", usage: `/profileset` },
      background:  { desc: "Browse, buy, and equip profile backgrounds.\n`/background shop` — browse\n`/background buy <id>` — purchase\n`/background equip <id>` — set active\n`/background owned` — your collection", usage: `/background`, aliases: "bg" },
      // Social
      partner:     { desc: "Propose a partnership to another player. Both players must confirm.", usage: `/partner <@user>` },
      divorce:     { desc: "End your current partnership. This is permanent!", usage: `/divorce` },
      giftcard:    { desc: "Gift a card to another player. Can be anonymous.\nRecipient gets a notification in their mail.", usage: `/giftcard <@user> <code> [anonymous]`, aliases: "gift" },
      gifts:       { desc: "View your pending gifts — accept or decline incoming card gifts.", usage: `/gifts` },
      givecosmetic:{ desc: "Gift a cosmetic item (hex, aura, frame, sticker) to another player.", usage: `/givecosmetic <@user> <type> <id>`, aliases: "gc" },
      mail:        { desc: "Check your inbox for notifications, gift alerts, and system messages.\n`/mail inbox` — view messages\n`/mail read <id>` — read one\n`/mail clear` — mark all read\n`/mail delete <id>` — delete", usage: `/mail inbox` },
      // Player
      inventory:   { desc: "View your currency balances — gold, petals, cinders, shards.", usage: `${p}i`, aliases: "i" },
      userinfo:    { desc: "View your stats — level, XP, summons, grabs, fusions, trades, gifts.", usage: `${p}ui`, aliases: "ui" },
      cg:          { desc: "Card Hunter search across character IDs, auctions, and bounties. Requires level 20.", usage: `${p}cg <query>`, aliases: "cardhunter, hunt" },
      seriesmatch: { desc: "Find other players who collect the same series as you.", usage: `/seriesmatch`, aliases: "sm" },
      likematch:   { desc: "Find other players with similar wishlists.", usage: `/likematch`, aliases: "lm" },
      content:     { desc: "View the 10 most recent summons in this server.", usage: `${p}content` },
      private:     { desc: "Toggle privacy on your profile fields — hide stats from other players.", usage: `/private`, aliases: "pr" },
      badges:      { desc: "View your earned badges and set an active badge for your profile.", usage: `/badges`, aliases: "b" },
      // Wish
      wish:        { desc: "Manage your wishlist and summon list.\n`wish list` — view likes\n`wish add <name>` — add to likes\n`wish remove <name>` — remove\n`wish summonlist` — view summon list\n`wish summonadd <name>` — add (2x odds)\n`wish summonremove <name>` — remove", usage: `${p}wish <subcommand>`, aliases: "wl" },
      // Achievements
      achievements:{ desc: "View all achievements with progress bars. Claim completed ones for rewards.", usage: `${p}achievements`, aliases: "ach" },
      completeachievement: { desc: "Claim the reward for a completed achievement.", usage: `/completeachievement <id>`, aliases: "ca" },
      // Minigames
      trivia:      { desc: "Anime trivia — answer a multiple-choice question within the time limit.", usage: `/trivia` },
      guess:       { desc: "Guess the character from a blurred/partial image. Type the name to answer.", usage: `/guess`, aliases: "mg1" },
      rps:         { desc: "Rock-Paper-Scissors against the bot. Win gold on victory!", usage: `/rps`, aliases: "mg3" },
      fish:        { desc: "Go fishing! Cast your line and catch fish for gold and rare items.", usage: `/fish`, aliases: "mg4" },
      // Leaderboard & Events
      leaderboard: { desc: "View global rankings — grabs, summons, gold, fusions, trades.", usage: `/leaderboard [type]`, aliases: "lb" },
      event:       { desc: "View the current seasonal event and its special cards.", usage: `/event` },
      // Settings (Admin)
      prefix:      { desc: "Change the bot prefix for this server. Max 5 characters. Requires **Manage Server**.", usage: `${p}prefix <new prefix>` },
      setchannel:  { desc: "Set a dedicated summon channel. Summons will only work there. Requires **Manage Server**.\nUse `setchannel clear` to remove.", usage: `${p}setchannel <#channel>` },
      antisnipe:   { desc: "Set a delay (0-30 seconds) before cards can be grabbed. Prevents sniping. Requires **Manage Server**.", usage: `/antisnipe <seconds>` },
      restrict:    { desc: "Restrict a command category to specific channels. Categories: play, economy, fusion, cosmetics.\nRequires **Manage Server**.", usage: `/restrict <category> <#channel>` },
    };

    const helpCategories: Record<string, { title: string; emoji: string; commands: string[] }> = {
      play: {
        title: "Play",
        emoji: "🃏",
        commands: ["summon", "view", "collection", "lookup", "cardinfo", "seriescompletion", "favorite", "cooldown", "alarm"],
      },
      economy: {
        title: "Economy",
        emoji: "💰",
        commands: ["daily", "balance", "give", "trade", "multitrade", "shop", "buy", "vote", "openpack", "upgrade", "burn", "buff", "potion", "slu", "lsu"],
      },
      fusion: {
        title: "Fusion",
        emoji: "🔥",
        commands: ["fusionboard", "fuseadd", "fuse", "fastfuse"],
      },
      tags: {
        title: "Tags",
        emoji: "🏷️",
        commands: ["tag", "tagadd", "tagremove", "tagrename", "tagreemote", "untag", "taglist"],
      },
      albums: {
        title: "Albums",
        emoji: "📚",
        commands: ["albums", "album", "albumadd", "albumremove", "renamealbum", "pageadd", "albumpageremove", "albumcard", "albumcardremove", "albumbackground", "albumpageswap"],
      },
      rpg: {
        title: "RPG",
        emoji: "⚔️",
        commands: ["teams", "team", "addteam", "deleteteam", "renameteam", "addmember", "removemember", "cardstats", "questlist", "questinfo", "quest", "quests", "completequest", "questreturn"],
      },
      cosmetics: {
        title: "Cosmetics",
        emoji: "✨",
        commands: ["framepreview", "use", "removehex", "removeaura", "removeframe", "spell", "stick", "cosmetics", "open"],
      },
      profile: {
        title: "Profile",
        emoji: "👤",
        commands: ["profile", "blurb", "profileset", "background"],
      },
      social: {
        title: "Social",
        emoji: "💝",
        commands: ["partner", "divorce", "giftcard", "gifts", "givecosmetic", "mail"],
      },
      player: {
        title: "Player Info",
        emoji: "📊",
        commands: ["inventory", "userinfo", "cg", "seriesmatch", "likematch", "content", "private", "badges"],
      },
      wishlist: {
        title: "Wishlist",
        emoji: "❤️",
        commands: ["wish"],
      },
      achievements: {
        title: "Achievements",
        emoji: "🏆",
        commands: ["achievements", "completeachievement"],
      },
      minigames: {
        title: "Minigames",
        emoji: "🎮",
        commands: ["trivia", "guess", "rps", "fish"],
      },
      other: {
        title: "Other",
        emoji: "📋",
        commands: ["leaderboard", "event"],
      },
      settings: {
        title: "Settings (Admin)",
        emoji: "⚙️",
        commands: ["prefix", "setchannel", "antisnipe", "restrict"],
      },
    };

    if (args.length > 0) {
      const target = args[0].toLowerCase();

      // Check if it's a category: ka!help cosmetics, ka!help tags, etc.
      const category = helpCategories[target];
      if (category) {
        const lines = category.commands.map((cmd) => {
          const d = helpDetail[cmd];
          if (!d) return `**${cmd}** — *No description*`;
          const aliasStr = d.aliases ? ` *(${d.aliases})*` : "";
          return `**${cmd}**${aliasStr}\n${d.desc}\nUsage: \`${d.usage}\``;
        });

        const catEmbed = new EmbedBuilder()
          .setColor(0x2b2d31)
          .setTitle(`${category.emoji} ${category.title} Commands`)
          .setDescription(lines.join("\n\n"))
          .setFooter({ text: `Kaoru | ${p}help <command> for more | ${p}help for all categories`, iconURL: message.client.user?.displayAvatarURL() });
        await message.reply({ embeds: [catEmbed] });
        return;
      }

      // Check if it's a specific command
      const detail = helpDetail[target];
      if (detail) {
        const detailEmbed = new EmbedBuilder()
          .setColor(0x2b2d31)
          .setTitle(`${target}`)
          .setDescription(detail.desc);
        detailEmbed.addFields({ name: "Usage", value: `\`${detail.usage}\`` });
        if (detail.aliases) {
          detailEmbed.addFields({ name: "Aliases", value: detail.aliases });
        }
        detailEmbed.setFooter({ text: `Kaoru | Prefix: ${p}`, iconURL: message.client.user?.displayAvatarURL() });
        await message.reply({ embeds: [detailEmbed] });
      } else {
        await message.reply(`Unknown command \`${target}\`. Type \`${p}help\` for the full list, or \`${p}help <category>\` for a group.`);
      }
      return;
    }

    const avatar = message.client.user?.displayAvatarURL();
    const pageSections: string[][] = [
      ["settings", "play", "player", "wishlist", "fusion", "achievements", "economy", "cosmetics", "tags"],
      ["rpg", "albums", "profile", "social", "minigames", "other"],
    ];

    const renderSection = (key: string): string => {
      const category = helpCategories[key];
      if (!category) return "";
      const cmdList = category.commands.map((cmd) => `\`${cmd}\``).join(", ");
      return `**${category.title} ${category.emoji}**\n${cmdList}`;
    };

    const buildHelpEmbed = (page: number): EmbedBuilder => {
      const sectionText = pageSections[page].map(renderSection).join("\n\n");
      return new EmbedBuilder()
        .setColor(0x2b2d31)
        .setAuthor({ name: "Kaoru Help", iconURL: avatar })
        .setDescription(
          `Type \`${p}help <command>\` to view more details about a command.\n\n${sectionText}\n\n` +
          `Note: Use \`${p}help <category>\` for expanded details.`
        )
        .setFooter({
          text: `${Object.keys(helpDetail).length} commands · Prefix: ${p} · Page ${page + 1}/${pageSections.length}`,
          iconURL: avatar,
        });
    };

    const buildHelpNav = (page: number) =>
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`help:prev:${page}`)
          .setEmoji("⬅")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page <= 0),
        new ButtonBuilder()
          .setCustomId(`help:next:${page}`)
          .setEmoji("➡")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page >= pageSections.length - 1)
      );

    let page = 0;
    const helpMsg = await message.reply({
      embeds: [buildHelpEmbed(page)],
      components: [buildHelpNav(page)],
    });

    const collector = helpMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120_000,
      filter: (i) => i.user.id === message.author.id,
    });

    collector.on("collect", async (i) => {
      const [scope, dir] = i.customId.split(":");
      if (scope !== "help") return;

      if (dir === "prev") page = Math.max(0, page - 1);
      if (dir === "next") page = Math.min(pageSections.length - 1, page + 1);

      await i.update({
        embeds: [buildHelpEmbed(page)],
        components: [buildHelpNav(page)],
      });
    });

    collector.on("end", async () => {
      await helpMsg.edit({ components: [] }).catch(() => {});
    });
    return;
  }

  // Prefix command (admin only)
  if (command === "prefix") {
    if (!message.member?.permissions.has("ManageGuild")) {
      await message.reply("You need **Manage Server** permission to change the prefix.");
      return;
    }
    const newPrefix = args[0];
    if (!newPrefix || newPrefix.length > 5) {
      await message.reply(`Current prefix: \`${prefix}\`. Usage: \`${prefix}prefix <new prefix>\``);
      return;
    }
    await db
      .update(guilds)
      .set({ prefix: newPrefix, updatedAt: new Date() })
      .where(eq(guilds.discordId, guildId));
    await message.reply(`Prefix updated to \`${newPrefix}\``);
    return;
  }

  const resolved = prefixAliases[command];
  if (!resolved) return;

  // Enforce channel restrictions
  const restricted = (guildConfig?.restrictedChannels ?? {}) as Record<string, string[]>;
  const COMMAND_CATEGORIES: Record<string, string> = {
    summon: "play", view: "play", collection: "play", lookup: "play",
    cardinfo: "play", seriescompletion: "play", favorite: "play", cooldown: "play", tag: "play", tags: "play",
    daily: "economy", balance: "economy", give: "economy", trade: "economy",
    multitrade: "economy", shop: "economy", vote: "economy", upgrade: "economy",
    openpack: "economy", givecosmetic: "economy", buff: "economy", potion: "economy", slu: "economy", lsu: "economy",
    auction: "economy",
    fusionboard: "fusion", fuseadd: "fusion", fuse: "fusion", fastfuse: "fusion",
    spell: "cosmetics", stick: "cosmetics", use: "cosmetics", removehex: "cosmetics", removeaura: "cosmetics",
    removeframe: "cosmetics", open: "cosmetics", cosmetics: "cosmetics",
  };
  const category = COMMAND_CATEGORIES[resolved];
  if (category && restricted[category]?.length > 0 && !restricted[category].includes(channelId)) {
    const channels = restricted[category].map((id) => `<#${id}>`).join(", ");
    await message.reply(`**${category}** commands are restricted to ${channels}`);
    return;
  }

  // Per-user command rate limit (3 sec between non-summon commands)
  if (resolved !== "summon") {
    const rlKey = `cmd_rl:${userId}`;
    const rl = await redis.get(rlKey);
    if (rl) {
      return; // silently ignore spammed commands
    }
    await redis.set(rlKey, "1", "EX", 3);
  }

  // Anti-bot check
  const abResult = await checkAntiBot(userId, resolved);
  if (!abResult.allowed) {
    await message.reply({ content: abResult.reason ?? "Action blocked." });
    return;
  }

  try {
    switch (resolved) {
      case "summon":
        // Enforce summon channel restriction
        if (guildConfig?.summonChannelId && channelId !== guildConfig.summonChannelId) {
          await message.reply(`Summons are restricted to <#${guildConfig.summonChannelId}>!`);
          return;
        }
        await summonPrefix(message);
        break;

      case "view":
        await handleView(message, args);
        break;

      case "collection":
        await handleCollection(message, args);
        break;

      case "lookup":
        await handleLookup(message, args);
        break;

      case "cardinfo":
        await handleCardInfo(message, args);
        break;

      case "cooldown": {
        const cooldowns = await getAllCooldowns(message.author.id);
        const embed = buildCooldownEmbed(cooldowns, message.author.username);
        await message.reply({ embeds: [embed] });
        break;
      }

      case "balance": {
        const bal = await getBalance(message.author.id);
        const balEmbed = new EmbedBuilder()
          .setColor(0xf1c40f)
          .setAuthor({ name: `${message.author.username}'s Balance`, iconURL: message.author.displayAvatarURL() })
          .setDescription(
            `💰 · **Gold** · \`${bal.gold}\`\n` +
            `🌸 · **Petals** · \`${bal.petals}\`\n` +
            `🔥 · **Cinders** · \`${bal.cinders}\`\n` +
            `✨ · **Shards** · \`${bal.shards}\``
          );
        await message.reply({ embeds: [balEmbed] });
        break;
      }

      case "daily": {
        const { claimDaily } = await import("../services/economy.service.js");
        const result = await claimDaily(message.author.id, message.author.username);
        if (result.success) {
          const dailyEmbed = new EmbedBuilder()
            .setColor(0x2ecc71)
            .setDescription(`You claimed your daily reward!\n+**${result.amount} gold**`);
          await message.reply({ embeds: [dailyEmbed] });
        } else {
          const hours = Math.floor(result.remaining / 3600);
          const mins = Math.floor((result.remaining % 3600) / 60);
          const dailyEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(`You have already claimed your daily.\nPlease come back in **${hours} hours${mins > 0 ? ` ${mins} minutes` : ""}**.`);
          await message.reply({ embeds: [dailyEmbed] });
        }
        break;
      }

      case "give": {
        await handleGive(message, args);
        break;
      }

      case "trade": {
        await handleTrade(message, args);
        break;
      }

      case "multitrade": {
        const { executePrefixMultitrade } = await import("../commands/economy/multitrade.js");
        await executePrefixMultitrade(message);
        break;
      }

      case "tag": {
        await handleTag(message, args);
        break;
      }

      case "tags": {
        // Redirected to taglist slash command
        await message.reply(`Use the slash command \`/taglist\` for this feature!`);
        break;
      }

      case "profile": {
        await handleProfile(message, args);
        break;
      }

      case "wish": {
        await handleWish(message, args);
        break;
      }

      case "wishadd": {
        await handleWish(message, ["add", ...args]);
        break;
      }

      case "wishremove": {
        await handleWish(message, ["remove", ...args]);
        break;
      }

      case "bounty": {
        await message.reply("Use `/bounty` for bounty board actions: post, list, claim, cancel.");
        break;
      }

      case "cg":
      case "cardhunter":
      case "hunt": {
        const { executePrefix } = await import("../commands/player/cg.js");
        await executePrefix(message, args);
        break;
      }

      case "auction": {
        const sub = (args[0] ?? "").toLowerCase();
        if (!sub || sub === "help") {
          await message.reply(
            `Auction usage:\n` +
            `\`${prefix}auction create <card_code> <starting_bid> <duration_minutes>\`\n` +
            `\`${prefix}auction bid <auction_id> <gold>\`\n` +
            `\`${prefix}auction list [limit]\`\n` +
            `\`${prefix}auction cancel <auction_id>\`\n` +
            `\`${prefix}auction settle <auction_id>\``
          );
          break;
        }

        if (sub === "create") {
          const cardCode = (args[1] ?? "").trim();
          const startingBid = Number(args[2]);
          const durationMinutes = Number(args[3]);
          if (!cardCode || !Number.isFinite(startingBid) || !Number.isFinite(durationMinutes)) {
            await message.reply(`Usage: \`${prefix}auction create <card_code> <starting_bid> <duration_minutes>\``);
            break;
          }
          const result = await createAuction(
            message.author.id,
            message.author.username,
            cardCode,
            Math.floor(startingBid),
            Math.floor(durationMinutes)
          );
          if (!result.success) {
            await message.reply(result.reason);
            break;
          }
          await message.reply(
            `🏷️ Auction #${result.auctionId} created for \`${result.cardCode}\` (**${result.characterName}**).\n` +
            `💰 Starting bid: **${result.startingBid.toLocaleString()} gold**\n` +
            `⏳ Ends: <t:${Math.floor(result.endsAt.getTime() / 1000)}:R>`
          );
          break;
        }

        if (sub === "bid") {
          const auctionId = Number(args[1]);
          const gold = Number(args[2]);
          if (!Number.isFinite(auctionId) || !Number.isFinite(gold)) {
            await message.reply(`Usage: \`${prefix}auction bid <auction_id> <gold>\``);
            break;
          }
          const result = await bidAuction(
            message.author.id,
            message.author.username,
            Math.floor(auctionId),
            Math.floor(gold)
          );
          if (!result.success) {
            await message.reply(result.reason);
            break;
          }
          await message.reply(
            `🪙 Bid placed on auction #${Math.floor(auctionId)}: **${result.currentBid.toLocaleString()} gold**.\n` +
            `${result.antiSnipeExtended ? "🛡️ Anti-snipe triggered: +2 minutes.\n" : ""}` +
            `⏳ Ends: <t:${Math.floor(result.endsAt.getTime() / 1000)}:R>`
          );
          break;
        }

        if (sub === "list") {
          const limitRaw = Number(args[1] ?? 10);
          const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(20, Math.floor(limitRaw))) : 10;
          const rows = await listActiveAuctions(limit);
          if (rows.length === 0) {
            await message.reply("No active auctions right now.");
            break;
          }
          const embed = new EmbedBuilder()
            .setColor(0xf39c12)
            .setTitle("Auction House")
            .setDescription(
              rows
                .map((a) => {
                  const current = a.currentBid ?? a.startingBid;
                  const bidder = a.currentBidderName ? ` • bidder: **${a.currentBidderName}**` : "";
                  return `#${a.id} • \`${a.cardCode}\` • **${a.characterName}** (${a.series})\n` +
                    `⭐ ${a.quality} • #${a.printNumber} • seller: **${a.sellerName}**\n` +
                    `💰 ${current.toLocaleString()} gold${bidder} • ends <t:${Math.floor(a.endsAt.getTime() / 1000)}:R>`;
                })
                .join("\n\n")
            );
          await message.reply({ embeds: [embed] });
          break;
        }

        if (sub === "cancel") {
          const auctionId = Number(args[1]);
          if (!Number.isFinite(auctionId)) {
            await message.reply(`Usage: \`${prefix}auction cancel <auction_id>\``);
            break;
          }
          const result = await cancelAuction(
            message.author.id,
            message.author.username,
            Math.floor(auctionId)
          );
          await message.reply(result.success
            ? `🧾 Auction #${Math.floor(auctionId)} cancelled. Your card was returned.`
            : result.reason);
          break;
        }

        if (sub === "settle") {
          const auctionId = Number(args[1]);
          if (!Number.isFinite(auctionId)) {
            await message.reply(`Usage: \`${prefix}auction settle <auction_id>\``);
            break;
          }
          const result = await settleAuction(Math.floor(auctionId));
          if (!result.success) {
            await message.reply(result.reason);
            break;
          }
          await message.reply(
            result.status === "settled"
              ? `✅ Auction #${Math.floor(auctionId)} settled. Winning bid: **${result.finalBid.toLocaleString()} gold**.`
              : `⌛ Auction #${Math.floor(auctionId)} expired with no bids. Card returned to seller.`
          );
          break;
        }

        await message.reply(
          `Unknown subcommand. Use \`${prefix}auction help\`.\n` +
          `Available: \`create\`, \`bid\`, \`list\`, \`cancel\`, \`settle\``
        );
        break;
      }

      case "leaderboard": {
        await handleLeaderboard(message);
        break;
      }

      case "shop": {
        await handleShop(message);
        break;
      }

      case "fusionboard": {
        await handleFusionBoard(message);
        break;
      }

      case "fuseadd": {
        await handleFuseAdd(message, args);
        break;
      }

      case "fuse": {
        await handleFuse(message);
        break;
      }

      case "fastfuse": {
        await handleFastFuse(message, args);
        break;
      }

      case "upgrade": {
        await handleUpgrade(message, args);
        break;
      }

      case "event": {
        await message.reply("No active event right now. Use `/event` to check for upcoming events!");
        break;
      }

      case "vote": {
        await message.reply("Vote for Kaoru and claim rewards! Use `/vote` to get started.");
        break;
      }

      case "partner": {
        const target = message.mentions.users.first();
        if (!target) { await message.reply(`Usage: \`ka!partner <@user>\``); break; }
        await message.reply(`Use \`/partner @${target.username}\` for the interactive partner proposal!`);
        break;
      }

      case "divorce": {
        await message.reply("Use `/divorce` to end your partnership.");
        break;
      }

      case "blurb": {
        const text = args.join(" ").slice(0, 200);
        if (!text) { await message.reply(`Usage: \`ka!blurb <your blurb text>\``); break; }
        await db.update(users).set({ blurb: text, updatedAt: new Date() })
          .where(eq(users.discordId, message.author.id));
        await message.reply(`Blurb updated!`);
        break;
      }

      case "achievements": {
        await handleAchievements(message);
        break;
      }

      case "trivia": {
        await message.reply("Use `/trivia` for the interactive trivia game with buttons!");
        break;
      }

      case "guide": {
        await message.reply("📖 **Kaoru Guide**\nUse `ka!help` for a command overview, or `ka!help <command>` for specific usage.\nUse `ka!help <category>` to browse by category (play, economy, fusion, tags, cosmetics, profile, social).");
        break;
      }

      case "invite": {
        const clientId = (await import("../config.js")).config.DISCORD_CLIENT_ID;
        const perms = "274878221376";
        const url = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${perms}&scope=bot%20applications.commands`;
        await message.reply(`🔗 **Invite Kaoru to your server:**\n${url}`);
        break;
      }

      case "achievementinfo":
      case "ai": {
        await handleAchievementInfo(message, args);
        break;
      }

      case "albums": {
        await handleAlbums(message, args);
        break;
      }
      case "album":
      case "alb": {
        await handleAlbumView(message, args);
        break;
      }
      case "albumadd":
      case "aa":
      case "albumcreate": {
        await handleAlbumAdd(message, args);
        break;
      }
      case "albumremove":
      case "alr": {
        await handleAlbumRemove(message, args);
        break;
      }
      case "renamealbum":
      case "ar": {
        await handleAlbumRename(message, args);
        break;
      }
      case "pageadd":
      case "pa": {
        await handlePageAdd(message, args);
        break;
      }
      case "albumpageremove":
      case "apr": {
        await handlePageRemove(message, args);
        break;
      }
      case "albumcard":
      case "albc": {
        await handleAlbumCard(message, args);
        break;
      }
      case "albumcardremove":
      case "acr": {
        await handleAlbumCardRemove(message, args);
        break;
      }
      case "albumbackground":
      case "ab": {
        await handleAlbumBackground(message, args);
        break;
      }
      case "albumpageswap":
      case "aps": {
        await handleAlbumPageSwap(message, args);
        break;
      }

      // ── RPG: Teams ──
      case "teams":
      case "ts": {
        await handleTeams(message, args);
        break;
      }
      case "team": {
        await handleTeamView(message, args);
        break;
      }
      case "addteam":
      case "at": {
        await handleAddTeam(message, args);
        break;
      }
      case "deleteteam":
      case "dt": {
        await handleDeleteTeam(message, args);
        break;
      }
      case "renameteam":
      case "rt": {
        await handleRenameTeam(message, args);
        break;
      }
      case "addmember":
      case "am": {
        await handleAddMember(message, args);
        break;
      }
      case "removemember":
      case "rm": {
        await handleRemoveMember(message, args);
        break;
      }
      case "cardstats":
      case "stats": {
        await handleCardStats(message, args);
        break;
      }

      // ── RPG: Quests ──
      case "questlist":
      case "ql": {
        await handleQuestList(message);
        break;
      }
      case "questinfo":
      case "qi": {
        await handleQuestInfo(message, args);
        break;
      }
      case "quest":
      case "q": {
        await handleStartQuest(message, args);
        break;
      }
      case "quests":
      case "qs": {
        await handleActiveQuests(message);
        break;
      }
      case "completequest":
      case "cq": {
        await handleCompleteQuest(message, args);
        break;
      }
      case "questreturn":
      case "qr": {
        await handleQuestReturn(message, args);
        break;
      }

      case "setchannel": {
        if (!message.member?.permissions.has("ManageGuild")) {
          await message.reply("You need **Manage Server** permission.");
          break;
        }
        const mentionedChannel = message.mentions.channels.first();
        if (!mentionedChannel) {
          await message.reply(`Usage: \`ka!setchannel #channel\` (or \`ka!setchannel clear\` to remove)`);
          break;
        }
        await db.update(guilds).set({ summonChannelId: mentionedChannel.id, updatedAt: new Date() })
          .where(eq(guilds.discordId, guildId));
        await message.reply(`Summon channel set to <#${mentionedChannel.id}>`);
        break;
      }

      case "antisnipe": {
        if (!message.member?.permissions.has("ManageGuild")) {
          await message.reply("You need **Manage Server** permission.");
          break;
        }
        const seconds = parseInt(args[0] ?? "0", 10);
        if (isNaN(seconds) || seconds < 0 || seconds > 30) {
          await message.reply(`Usage: \`ka!antisnipe <0-30>\` (seconds)`);
          break;
        }
        await db.update(guilds).set({ antiSnipeSeconds: seconds, updatedAt: new Date() })
          .where(eq(guilds.discordId, guildId));
        await message.reply(seconds > 0 ? `Anti-snipe set to **${seconds}s**` : "Anti-snipe disabled.");
        break;
      }

      case "inventory": {
        const invUser = await db.query.users.findFirst({
          where: eq(users.discordId, message.author.id),
          columns: { gold: true, opals: true, cinders: true, shards: true },
        });
        if (!invUser) { await message.reply("Start playing first by summoning!"); break; }
        const invEmbed = new EmbedBuilder()
          .setColor(0x2b2d31)
          .setAuthor({ name: `${message.author.username}'s Inventory`, iconURL: message.author.displayAvatarURL() })
          .setDescription(
            `💰 Gold · **${invUser.gold.toLocaleString()}**\n` +
            `🌸 Petals · **${invUser.opals.toLocaleString()}**\n` +
            `🔥 Cinders · **${invUser.cinders.toLocaleString()}**\n` +
            `✨ Shards · **${invUser.shards.toLocaleString()}**`
          );
        await message.reply({ embeds: [invEmbed] });
        break;
      }

      case "slu":
      case "summonlistupgrade": {
        await handleSlotUpgrade(message, "summon");
        break;
      }

      case "lsu":
      case "likelistupgrade":
      case "llu": {
        await handleSlotUpgrade(message, "like");
        break;
      }

      case "buff":
      case "buffs": {
        await handleBuff(message, args);
        break;
      }

      case "potion":
      case "potions": {
        await handlePotion(message, args);
        break;
      }

      case "framepreview":
      case "fp": {
        await handleFramePreview(message, args);
        break;
      }

      case "seriescompletion":
      case "sc": {
        await handleSeriesCompletion(message, args);
        break;
      }

      case "favorite":
      case "fav": {
        await handleFavorite(message, args);
        break;
      }

      case "userinfo": {
        const uiUser = await db.query.users.findFirst({
          where: eq(users.discordId, message.author.id),
        });
        if (!uiUser) { await message.reply("Start playing first by summoning!"); break; }
        const uiEmbed = new EmbedBuilder()
          .setColor(0x2b2d31)
          .setAuthor({ name: `${message.author.username}'s Info`, iconURL: message.author.displayAvatarURL() })
          .setDescription(
            `Level **${uiUser.level}** · ${uiUser.xp} XP\n` +
            `Joined <t:${Math.floor(uiUser.joinedAt.getTime() / 1000)}:R>\n\n` +
            `Summons · **${uiUser.totalSummons}** | Grabs · **${uiUser.totalGrabs}**\n` +
            `Fusions · **${uiUser.totalFusions}** | Trades · **${uiUser.totalTrades}** | Gifts · **${uiUser.totalGifts}**`
          );
        await message.reply({ embeds: [uiEmbed] });
        break;
      }

      case "burn": {
        const burnCode = args[0];
        if (!burnCode) { await message.reply("Usage: `burn <card code>`"); break; }
        await message.reply(`Use the slash command \`/burn\` for this feature!`);
        break;
      }

      case "content": {
        const recentCards = await db
          .select({ code: cards.code, charName: characters.name, printNumber: cards.printNumber, summonedAt: cards.summonedAt, ownerId: cards.ownerId })
          .from(cards)
          .innerJoin(characters, eq(cards.characterId, characters.id))
          .where(eq(cards.guildId, guildId))
          .orderBy(desc(cards.summonedAt))
          .limit(10);
        if (recentCards.length === 0) { await message.reply("No summons in this server yet!"); break; }
        const contentLines = recentCards.map((r) => {
          const claimed = r.ownerId ? "✅" : "❌";
          return `${claimed} **${r.charName}** · #${r.printNumber} · \`${r.code}\` · <t:${Math.floor(r.summonedAt.getTime() / 1000)}:R>`;
        });
        const contentEmbed = new EmbedBuilder()
          .setColor(0x2b2d31).setTitle("Recent Summons").setDescription(contentLines.join("\n"));
        await message.reply({ embeds: [contentEmbed] });
        break;
      }

      case "private":
      case "badges":
      case "likematch":
      case "seriesmatch":
      case "completeachievement":
      case "tagadd":
      case "tagremove":
      case "tagrename":
      case "tagreemote":
      case "untag":
      case "taglist":
        await message.reply(`Use the slash command \`/${resolved}\` for this feature!`);
        break;

      default:
        await message.reply(`Use the slash command \`/${resolved}\` for this feature!`);
        break;
    }
  } catch (err) {
    console.error(`[Prefix] Error in ${resolved}:`, err);
    await message.reply("Something went wrong. Try again!").catch(() => {});
  }
}

// ─── View: k!v or k!v <code> ────────────────────────────

async function handleView(message: Message, args: string[]) {
  const discordId = message.author.id;
  const username = message.author.username;

  let card;

  // Check if arg is a @mention — show that user's last card
  const mentionedUser = message.mentions.users.first();
  let targetDiscordId = discordId;

  if (mentionedUser) {
    targetDiscordId = mentionedUser.id;
  } else if (args.length > 0) {
    // Not a mention — treat as card code
    card = await getCardByCode(args[0]);
    if (!card) {
      await message.reply("Card not found.");
      return;
    }
  }

  if (!card) {
    // View last grabbed card for target user
    const [userRecord] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.discordId, targetDiscordId))
      .limit(1);
    if (!userRecord) {
      await message.reply("You haven't grabbed any cards yet!");
      return;
    }

    const lastCard = await db
      .select({ code: cards.code })
      .from(cards)
      .where(eq(cards.ownerId, userRecord.id))
      .orderBy(desc(cards.grabbedAt))
      .limit(1);

    if (lastCard.length === 0) {
      await message.reply("You don't own any cards yet!");
      return;
    }

    card = await getCardByCode(lastCard[0].code);
  }

  if (!card) {
    await message.reply("Card not found.");
    return;
  }

  // Render full-size card
  try {
    const charImage = await loadCharacterImage(card.edition.imagePath);
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
          // continue
        }
      }
    }
    const cardBuffer = await renderCard({
      cardCode: card.code,
      characterImage: charImage,
      name: card.character.name,
      series: card.character.series,
      quality: card.quality,
      printNumber: card.printNumber,
      editionNumber: card.edition.editionNumber,
      frame: frameBuffer,
      tag: card.tag ?? undefined,
      tagEmoji: card.tagEmoji ?? undefined,
      isAdminExclusive: card.edition.generationMethod === "admin_exclusive",
    });

    const filename = `card-${card.code}.png`;
    const attachment = new AttachmentBuilder(cardBuffer, { name: filename });
    const hearts = await getWishlistCount(card.character.id);
    const owner = card.ownerDiscordId ? `<@${card.ownerDiscordId}>` : "*Unclaimed*";

    const QUALITY_GEMS: Record<string, string> = {
      damaged: "⬛", poor: "⬜", good: "🔷", excellent: "🔶", pristine: "💎",
    };
    const gem = QUALITY_GEMS[card.quality] ?? "◆";

    const isAdmin = card.edition.generationMethod === "admin_exclusive";

    let viewEmbed: EmbedBuilder;

    if (isAdmin) {
      viewEmbed = new EmbedBuilder()
        .setColor(0xffd700)
        .setAuthor({ name: "⭐ Exclusive Card", iconURL: "https://cdn.discordapp.com/emojis/1015955886340055191.webp" })
        .setTitle(`${card.character.name}`)
        .setDescription(
          `*A rare admin-granted exclusive card.*\n\n` +
          `🎁 Granted to ${owner}\n` +
          `━━━━━━━━━━━━━━━\n` +
          `Series · **${card.character.series}**\n` +
          `Code · \`${card.code}\`\n` +
          `Quality · ${gem} **${card.quality}**\n` +
          `Print · **#${card.printNumber}**\n` +
          `Likes · ❤${hearts}\n` +
          `━━━━━━━━━━━━━━━\n` +
          `⭐ *This card cannot be obtained through summoning.*`
        )
        .setImage(`attachment://${filename}`)
        .setFooter({ text: "Admin Exclusive Edition · Kaoru" });
    } else {
      viewEmbed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle("Card View")
        .setDescription(
          `Owner · ${owner}\n\n` +
          `❤${hearts} · \`${card.code}\` · ${gem} · ◎ ${card.edition.editionNumber} · #${card.printNumber}\n` +
          `${card.character.series} · **${card.character.name}**`
        )
        .setImage(`attachment://${filename}`);
    }

    await message.reply({ embeds: [viewEmbed], files: [attachment] });
  } catch {
    await message.reply(
      `\`${card.code}\` · ${qualityStars(card.quality)} · ◎ ${card.edition.editionNumber} · #${card.printNumber} · ${card.character.series} · **${card.character.name}**`
    );
  }
}

// ─── Collection: k!c [page] ─────────────────────────────

async function handleCollection(message: Message, args: string[]) {
  const mentionedUser = message.mentions.users.first();
  const targetDiscordId = mentionedUser?.id ?? message.author.id;
  const targetName = mentionedUser?.username ?? message.author.username;
  await ensureUser(targetDiscordId, targetName);

  const cleanArgs = args.filter(a => !a.startsWith("<@"));

  // If first arg looks like a card code, redirect to view
  if (cleanArgs[0] && isNaN(parseInt(cleanArgs[0], 10)) && cleanArgs[0].length >= 5 && !cleanArgs[0].includes("=") && !cleanArgs[0].includes(">") && !cleanArgs[0].includes("<")) {
    return handleView(message, args);
  }

  // Parse filter/sort args  (ka!c o=print q=4 n>5 t=fav s=naruto pg=2)
  // Also accept a bare number as page
  const filterArgs: string[] = [];
  let rawPage: number | undefined;
  for (const a of cleanArgs) {
    if (/^\d+$/.test(a)) rawPage = parseInt(a, 10);
    else filterArgs.push(a);
  }
  const { filter, sort, page: parsedPage } = parseCollectionArgs(filterArgs);
  const page = rawPage ?? parsedPage;

  const result = await getUserCollection(targetDiscordId, page, 6, filter, sort);

  if (result.cards.length === 0) {
    const hasFilters = filterArgs.length > 0;
    await message.reply(hasFilters ? "No cards match those filters." : "No cards found! Use `ka!s` to summon.");
    return;
  }

  const list = result.cards
    .map((c) => {
      const stars = qualityStars(c.quality);
      const likes = c.character.popularity ?? 0;
      const tagStr = c.tag ? ` · 🏷️${c.tag}` : "";
      return `╭ **${c.character.name}**\n` +
        `│ ${c.character.series}\n` +
        `│ ◎${c.edition.editionNumber} · #${c.printNumber} · ${stars} · 🤍${likes}${tagStr}\n` +
        `╰ \`${c.code}\``;
    })
    .join("\n");

  const startIdx = (result.page - 1) * 6 + 1;
  const endIdx = startIdx + result.cards.length - 1;

  // Show active filters in footer
  const filterParts: string[] = [];
  if (filter.characterName) filterParts.push(`c=${filter.characterName}`);
  if (filter.series) filterParts.push(`s=${filter.series}`);
  if (filter.quality) filterParts.push(`q=${filter.quality}`);
  if (filter.tag) filterParts.push(`t=${filter.tag}`);
  if (filter.untagged) filterParts.push("untagged");
  if (filter.printMin !== undefined) filterParts.push(`n>${filter.printMin}`);
  if (filter.printMax !== undefined) filterParts.push(`n<${filter.printMax}`);
  const filterStr = filterParts.length > 0 ? ` · ${filterParts.join(" ")}` : "";

  // Encode filter args into button customId for pagination
  const filterEncoded = filterArgs.length > 0 ? `:${encodeURIComponent(filterArgs.join(" "))}` : "";

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setAuthor({ name: `${targetName}'s Collection`, iconURL: (mentionedUser ?? message.author).displayAvatarURL() })
    .setDescription(list)
    .setFooter({ text: `Showing ${startIdx}-${endIdx} of ${result.total} · Page ${result.page}/${result.totalPages}${filterStr}` });

  const eid = encodeURIComponent(message.author.id);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`col:prev:${result.page - 1}:${eid}${filterEncoded}`)
      .setEmoji("⬅")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(result.page <= 1),
    new ButtonBuilder()
      .setCustomId(`col:next:${result.page + 1}:${eid}${filterEncoded}`)
      .setEmoji("➡")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(result.page >= result.totalPages),
  );

  await message.reply({ embeds: [embed], components: [row] });
}

// ─── Lookup: k!lu <name> ────────────────────────────────

async function handleLookup(message: Message, args: string[]) {
  const rawQuery = args.join(" ");
  const { likeList } = await import("../db/schema.js");
  const noQuery = args.length === 0;

  // Parse filter syntax: series:xxx or s:xxx, character:xxx or c:xxx
  const seriesFilter = (rawQuery.match(/(?:series|s):(\S+)/i)?.[1])?.replace(/_/g, " ");
  const charFilter = (rawQuery.match(/(?:character|chr|c):(\S+)/i)?.[1])?.replace(/_/g, " ");

  // Default lookup list: top characters across full pool.
  if (noQuery && !seriesFilter && !charFilter) {
    const baseCandidates = await db
      .select({
        id: characters.id,
        name: characters.name,
        series: characters.series,
        popularity: characters.popularity,
        wishlistCount: sql<number>`COALESCE((SELECT count(*) FROM like_list WHERE character_id = ${characters.id}), 0)`,
      })
      .from(characters)
      .orderBy(
        desc(characters.popularity),
        sql`COALESCE((SELECT count(*) FROM like_list WHERE character_id = ${characters.id}), 0) DESC`
      )
      .limit(600);

    const { getCommunityWeight } = await import("../services/community-weight.service.js");
    const ranked = await Promise.all(
      baseCandidates.map(async (c) => ({
        ...c,
        communityWeight: await getCommunityWeight(c.series, c.name),
      }))
    );

    const defaultResults = ranked
      .sort((a, b) =>
        (b.communityWeight - a.communityWeight)
        || ((b.popularity ?? 0) - (a.popularity ?? 0))
        || ((b.wishlistCount ?? 0) - (a.wishlistCount ?? 0))
      )
      .slice(0, 10);

    const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(characters);
    const [{ trackedTotal }] = await db.select({ trackedTotal: sql<number>`count(*)` }).from(likeList);

    if (defaultResults.length === 0) {
      await message.reply("No characters available yet.");
      return;
    }

    const list = defaultResults
      .map((c, i) => `${i + 1}. ${c.series} · **${c.name}** · \`❤${c.wishlistCount}\``)
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setAuthor({ name: `${message.author.username}'s Lookup`, iconURL: message.author.displayAvatarURL() })
      .setDescription(`Type the number that corresponds to the characters you are looking for.\n\n${list}`)
      .setFooter({ text: `Showing characters 1-${defaultResults.length} of ${total} · rank source: community + likes(${trackedTotal})` });

    const totalPages = Math.ceil(total / 10);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("lu:first::1").setEmoji("⏮").setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId("lu:prev::1").setEmoji("⬅").setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId("lu:next::2").setEmoji("➡").setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1),
      new ButtonBuilder().setCustomId(`lu:last::${totalPages}`).setEmoji("⏭").setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1),
    );

    const luMsg = await message.reply({ embeds: [embed], components: [row] });
    awaitLookupSelection(message, defaultResults, luMsg);
    return;
  }

  // If both filters provided, do a combined search
  if (seriesFilter && charFilter) {
    const combined = await db
      .select({
        id: characters.id,
        name: characters.name,
        series: characters.series,
        popularity: characters.popularity,
        wishlistCount: sql<number>`COALESCE((SELECT count(*) FROM like_list WHERE character_id = ${characters.id}), 0)`,
      })
      .from(characters)
      .where(sql`LOWER(${characters.series}) LIKE LOWER(${'%' + seriesFilter + '%'}) AND LOWER(${characters.name}) LIKE LOWER(${'%' + charFilter + '%'})`)
      .orderBy(
        sql`COALESCE((SELECT count(*) FROM like_list WHERE character_id = ${characters.id}), 0) DESC`,
        desc(characters.popularity)
      )
      .limit(10);

    if (combined.length === 1) {
      const fakeMsg = await message.reply("Loading...");
      await awaitLookupSelection(message, combined, fakeMsg, true);
      return;
    }

    if (combined.length > 0) {
      const list = combined.map((c, i) => `${i + 1}. ${c.series} · **${c.name}** · \`❤${c.wishlistCount}\``).join("\n");
      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setAuthor({ name: `${message.author.username}'s Lookup`, iconURL: message.author.displayAvatarURL() })
        .setDescription(`Type the number that corresponds to the characters you are looking for.\n\n${list}`)
        .setFooter({ text: `${combined.length} results` });
      const luMsg = await message.reply({ embeds: [embed] });
      awaitLookupSelection(message, combined, luMsg);
      return;
    }

    await message.reply(`No characters found matching series:"${seriesFilter}" character:"${charFilter}".`);
    return;
  }

  // If only character filter, search by name
  if (charFilter) {
    const query = charFilter;
    const result = await searchCharacters(query, 0, 10);
    if (result.total === 1) {
      const c = result.characters[0];
      const fakeMsg = await message.reply("Loading...");
      await awaitLookupSelection(message, [{ id: c.id, name: c.name, series: c.series, popularity: c.popularity }], fakeMsg, true);
      return;
    }
    if (result.characters.length > 0) {
      const list = result.characters.map((c, i) => `${i + 1}. ${c.series} · **${c.name}** · \`❤0\``).join("\n");
      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setAuthor({ name: `${message.author.username}'s Lookup`, iconURL: message.author.displayAvatarURL() })
        .setDescription(`Type the number that corresponds to the characters you are looking for.\n\n${list}`)
        .setFooter({ text: `${result.total} results` });
      const luMsg = await message.reply({ embeds: [embed] });
      awaitLookupSelection(message, result.characters.map((c) => ({ id: c.id, name: c.name, series: c.series, popularity: c.popularity })), luMsg);
      return;
    }
    await message.reply(`No characters found for "${query}".`);
    return;
  }

  // Use seriesFilter if provided, otherwise use raw query
  const query = seriesFilter ?? rawQuery;

  // First try series search — order by wishlist count first, then AniList popularity
  const seriesResults = await db
    .select({
      id: characters.id,
      name: characters.name,
      series: characters.series,
      popularity: characters.popularity,
      wishlistCount: sql<number>`COALESCE((SELECT count(*) FROM like_list WHERE character_id = ${characters.id}), 0)`,
    })
    .from(characters)
    .where(sql`LOWER(${characters.series}) LIKE LOWER(${'%' + query + '%'})`)
    .orderBy(
      sql`COALESCE((SELECT count(*) FROM like_list WHERE character_id = ${characters.id}), 0) DESC`,
      desc(characters.popularity)
    )
    .limit(10);

  // If series search finds results, show them with heart counts
  if (seriesResults.length > 0) {
    // If exactly 1 result, skip number selection and show detail directly
    if (seriesResults.length === 1) {
      const fakeMsg = await message.reply("Loading...");
      const results = seriesResults.map((c) => ({ id: c.id, name: c.name, series: c.series, popularity: c.popularity }));
      await awaitLookupSelection(message, results, fakeMsg, true);
      return;
    }

    // Get heart counts for these characters
    const charIds = seriesResults.map((c) => c.id);
    const heartCounts = await db
      .select({ characterId: likeList.characterId, hearts: sql<number>`count(*)` })
      .from(likeList)
      .where(sql`${likeList.characterId} IN ${charIds}`)
      .groupBy(likeList.characterId);

    const heartMap = new Map(heartCounts.map((h) => [h.characterId, h.hearts]));

    // Count total characters in this series
    const [{ total: seriesTotal }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(characters)
      .where(sql`LOWER(${characters.series}) LIKE LOWER(${'%' + query + '%'})`);

    const list = seriesResults
      .map((c, i) => {
        const hearts = heartMap.get(c.id) ?? c.wishlistCount ?? 0;
        return `${i + 1}. ${c.series} · **${c.name}** · \`❤${hearts}\``;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setAuthor({ name: `${message.author.username}'s Lookup`, iconURL: message.author.displayAvatarURL() })
      .setDescription(`Type the number that corresponds to the characters you are looking for.\n\n${list}`)
      .setFooter({ text: `Showing characters 1-${seriesResults.length} of ${seriesTotal}` });

    // Encode query in custom ID (truncate to fit Discord's 100 char limit)
    const q = encodeURIComponent(query.slice(0, 40));
    const totalPages = Math.ceil(seriesTotal / 10);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`lu:first:${q}:1`).setEmoji("⏮").setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId(`lu:prev:${q}:1`).setEmoji("⬅").setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId(`lu:next:${q}:2`).setEmoji("➡").setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1),
      new ButtonBuilder().setCustomId(`lu:last:${q}:${totalPages}`).setEmoji("⏭").setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1),
    );

    const luMsg = await message.reply({ embeds: [embed], components: [row] });
    // Watch for number reply to select a character
    awaitLookupSelection(message, seriesResults, luMsg);
    return;
  }

  // Fallback to character name search
  const result = await searchCharacters(query, 0, 10);

  if (result.characters.length === 0) {
    await message.reply(`No characters found for "${query}".`);
    return;
  }

  // Single result — show detail directly
  if (result.total === 1) {
    const c = result.characters[0];
    const fakeMsg = await message.reply("Loading...");
    await awaitLookupSelection(message, [{ id: c.id, name: c.name, series: c.series, popularity: c.popularity }], fakeMsg, true);
    return;
  }

  const list = result.characters
    .map((c, i) => `${i + 1}. ${c.series} · **${c.name}** · \`❤0\``)
    .join("\n");

  const totalPages = Math.ceil(result.total / 10);
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: `${message.author.username}'s Lookup`, iconURL: message.author.displayAvatarURL() })
    .setDescription(`Type the number that corresponds to the characters you are looking for.\n\n${list}`)
    .setFooter({ text: `Showing characters 1-${result.characters.length} of ${result.total}` });

  const q = encodeURIComponent(query.slice(0, 40));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`lu:first:${q}:1`).setEmoji("⏮").setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId(`lu:prev:${q}:1`).setEmoji("⬅").setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId(`lu:next:${q}:2`).setEmoji("➡").setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1),
    new ButtonBuilder().setCustomId(`lu:last:${q}:${totalPages}`).setEmoji("⏭").setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1),
  );

  const luMsg = await message.reply({ embeds: [embed], components: [row] });
  awaitLookupSelection(message, result.characters.map((c) => ({ id: c.id, name: c.name, series: c.series, popularity: c.popularity })), luMsg);
}

// ─── Lookup Selection: watch for number reply ───────────

async function awaitLookupSelection(
  message: Message,
  results: Array<{ id: number; name: string; series: string; popularity: number | null }>,
  replyMsg: Message,
  autoSelect: boolean = false
) {
  // If auto-select (single result), skip waiting for number
  let char: typeof results[0];
  const channel = message.channel as any;

  if (autoSelect && results.length === 1) {
    char = results[0];
  } else {
    // Remove buttons after 60s
    const timeout = setTimeout(async () => {
      try { await replyMsg.edit({ components: [] }); } catch {}
    }, 60_000);

    try {
      const collected = await channel.awaitMessages({
        filter: (m: any) => m.author.id === message.author.id && /^\d{1,4}$/.test(m.content.trim()),
        max: 1,
        time: 30_000,
      });

      const reply = collected.first();
      if (!reply) { clearTimeout(timeout); return; }

      const num = parseInt(reply.content.trim(), 10);
      // Number is 1-indexed position in the full result set
      // If within the current page (results array), use directly
      const idx = num - 1;
      if (idx < 0) { clearTimeout(timeout); return; }

      if (idx < results.length) {
        char = results[idx];
      } else {
        // Number is beyond current page — fetch from DB by offset
        const { characters: chars2 } = await import("../db/schema.js");
        const [found] = await db
          .select({ id: chars2.id, name: chars2.name, series: chars2.series, popularity: chars2.popularity })
          .from(chars2)
          .where(sql`LOWER(${chars2.series}) LIKE LOWER(${'%' + (results[0]?.series ?? '') + '%'})`)
          .orderBy(desc(chars2.popularity))
          .offset(idx)
          .limit(1);
        if (!found) { clearTimeout(timeout); return; }
        char = found;
      }
      clearTimeout(timeout);
    } catch { return; }
  }

  // Show character detail
  try {
    // Fetch character editions
    const { characterEditions } = await import("../db/schema.js");
    const editions = await db
      .select({
        id: characterEditions.id,
        editionNumber: characterEditions.editionNumber,
        imagePath: characterEditions.imagePath,
        generationMethod: characterEditions.generationMethod,
      })
      .from(characterEditions)
      .where(eq(characterEditions.characterId, char.id))
      .orderBy(characterEditions.editionNumber);

    // Get real wishlist count
    const wishlistCount = await getWishlistCount(char.id);

    // Get stats for this character
    const [summonStats] = await db
      .select({
        totalSummoned: sql<number>`count(*)`,
        totalClaimed: sql<number>`count(${cards.ownerId})`,
      })
      .from(cards)
      .where(eq(cards.characterId, char.id));

    const totalSummoned = summonStats?.totalSummoned ?? 0;
    const totalClaimed = summonStats?.totalClaimed ?? 0;
    const claimRate = totalSummoned > 0 ? Math.round((totalClaimed / totalSummoned) * 100) : 0;

    // Load character thumbnail (small image)
    let thumbnailUrl: string | undefined;
    try {
      const charImg = await loadCharacterImage(editions[0]?.imagePath ?? "");
      // We'll use the AniList image URL directly as thumbnail instead of rendering
    } catch {}

    const editionLabel = editions[0]?.generationMethod === "original"
      ? `Edition 1`
      : `${editions[0]?.generationMethod ?? "Edition 1"}`;

    const detailEmbed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setAuthor({ name: `${message.author.username}'s Lookup`, iconURL: message.author.displayAvatarURL() })
      .setDescription(
        `Character · **${char.name}**\n` +
        `Series · **${char.series}**\n` +
        `Edition · ◎${editions[0]?.editionNumber ?? 1}\n\n` +
        `Wishlist · ❤${wishlistCount}\n\n` +
        `Total summoned · **${totalSummoned}**\n` +
        `Summons claimed · **${totalClaimed}**\n` +
        `Summon claim rate · **${claimRate}%**`
      );

    // Set character image as thumbnail if available from AniList
    const charRecord = await db
      .select({ imageUrl: characters.imageUrl })
      .from(characters)
      .where(eq(characters.id, char.id))
      .limit(1);
    if (charRecord[0]?.imageUrl) {
      detailEmbed.setThumbnail(charRecord[0].imageUrl);
    }

    // Edition dropdown
    const { StringSelectMenuBuilder } = await import("discord.js");
    const components: any[] = [];

    if (editions.length > 1) {
      const editionMenu = new StringSelectMenuBuilder()
        .setCustomId(`lu_edition:${char.id}`)
        .setPlaceholder(`Edition ${editions[0]?.editionNumber ?? 1}`)
        .addOptions(
          editions.slice(0, 25).map((e) => ({
            label: `Edition ${e.editionNumber}`,
            description: e.generationMethod,
            value: `${e.id}`,
            emoji: e.editionNumber === 1 ? "1️⃣" : undefined,
          }))
        );

      const { ActionRowBuilder: ARB } = await import("discord.js");
      components.push(new ARB().addComponents(editionMenu));
    }

    // Nav buttons + magnifier
    const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`ludet:first:${char.id}`).setEmoji("⏮").setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId(`ludet:prev:${char.id}`).setEmoji("⬅").setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId(`ludet:next:${char.id}`).setEmoji("➡").setStyle(ButtonStyle.Primary).setDisabled(editions.length <= 1),
      new ButtonBuilder().setCustomId(`ludet:last:${char.id}`).setEmoji("⏭").setStyle(ButtonStyle.Primary).setDisabled(editions.length <= 1),
      new ButtonBuilder().setCustomId(`ludet:zoom:${editions[0]?.id ?? 0}`).setEmoji("🔍").setStyle(ButtonStyle.Secondary),
    );
    components.push(navRow);

    await channel.send({ embeds: [detailEmbed], components });
    // Delete "Loading..." or remove buttons from lookup list
    try { await replyMsg.delete(); } catch { try { await replyMsg.edit({ components: [] }); } catch {} }
  } catch {
    const detailEmbed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setAuthor({ name: `${message.author.username}'s Lookup`, iconURL: message.author.displayAvatarURL() })
      .setDescription(`Character · **${char.name}**\nSeries · **${char.series}**\nWishlist · ❤0`);
    await channel.send({ embeds: [detailEmbed] });
    try { await replyMsg.delete(); } catch {}
  }
}

// ─── Card Info: ka!ci <code> ─────────────────────────────

const CI_QUALITY_DISPLAY: Record<string, { emoji: string; label: string }> = {
  damaged: { emoji: "💔", label: "Damaged" },
  poor: { emoji: "🍂", label: "Poor" },
  good: { emoji: "🍀", label: "Good" },
  excellent: { emoji: "💎", label: "Excellent" },
  pristine: { emoji: "💠", label: "Pristine" },
};

const CI_QUALITY_COLORS: Record<string, number> = {
  damaged: 0x808080,
  poor: 0xc0c0c0,
  good: 0x3498db,
  excellent: 0x9b59b6,
  pristine: 0xf1c40f,
};

async function handleCardInfo(message: Message, args: string[]) {
  let card;
  if (args.length === 0) {
    // No code provided — show the user's last grabbed card
    const [userRecord] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.discordId, message.author.id))
      .limit(1);
    if (!userRecord) {
      await message.reply("You haven't grabbed any cards yet!");
      return;
    }
    const [lastCard] = await db
      .select({ code: cards.code })
      .from(cards)
      .where(eq(cards.ownerId, userRecord.id))
      .orderBy(desc(cards.grabbedAt))
      .limit(1);
    if (!lastCard) {
      await message.reply("You don't own any cards yet!");
      return;
    }
    card = await getCardByCode(lastCard.code);
  } else {
    card = await getCardByCode(args[0]);
    // If not a card code, try as character name → redirect to lookup
    if (!card && args[0].length > 6) {
      return handleLookup(message, args);
    }
  }

  if (!card) {
    await message.reply("Card not found.");
    return;
  }

  const hearts = await getWishlistCount(card.character.id);

  // Quality display
  const currentQ = CI_QUALITY_DISPLAY[card.quality] ?? { emoji: "🍀", label: card.quality };
  const origQuality = card.originalQuality ?? card.quality;
  const originalQ = CI_QUALITY_DISPLAY[origQuality] ?? { emoji: "🍀", label: origQuality };
  const qualityLine = card.quality !== origQuality
    ? `${originalQ.emoji} ${originalQ.label} ➜ ${currentQ.emoji} ${currentQ.label}`
    : `${currentQ.emoji} ${currentQ.label}`;

  // Discord timestamp for grabbed date
  const grabbedTimestamp = card.grabbedAt
    ? `<t:${Math.floor(card.grabbedAt.getTime() / 1000)}:R>`
    : "*Not grabbed*";

  // Tag line
  const tagLine = card.tag
    ? `\n${card.tagEmoji ?? "🏷️"} ${card.tag}`
    : "";

  const lines: string[] = [
    `❤️ **${hearts}** · \`${card.code}\` · ${formatPrint(card.printNumber)} · ◎${card.edition.editionNumber}`,
    `**${card.character.name}**`,
    `${card.character.series}`,
    "",
    `Quality · ${qualityLine}`,
    `Owner · ${card.ownerDiscordId ? `<@${card.ownerDiscordId}>` : "*Unclaimed*"}`,
    `Summoner · ${card.summonerDiscordId ? `<@${card.summonerDiscordId}>` : "*Unknown*"}`,
    `Grabbed · ${grabbedTimestamp}`,
  ];

  if (tagLine) {
    lines.push(`Tag · ${tagLine.trim()}`);
  }

  // Load card image for thumbnail
  let attachment: AttachmentBuilder | undefined;
  const filename = `card-${card.code}.png`;
  try {
    const imageBuffer = await loadCharacterImage(card.edition.imagePath);
    attachment = new AttachmentBuilder(imageBuffer, { name: filename });
  } catch {
    // No image available
  }

  const embed = new EmbedBuilder()
    .setColor(CI_QUALITY_COLORS[card.quality] ?? 0x3498db)
    .setAuthor({ name: `Card Info`, iconURL: message.author.displayAvatarURL() })
    .setDescription(lines.join("\n"));

  if (attachment) {
    embed.setThumbnail(`attachment://${filename}`);
  }

  await message.reply({
    embeds: [embed],
    ...(attachment ? { files: [attachment] } : {}),
  });
}

// ─── Give: k!give <@user> <code> ────────────────────────

async function handleGive(message: Message, args: string[]) {
  const { checkLevel, LEVEL_REQUIREMENTS } = await import("../services/level.service.js");
  const uid = await ensureUser(message.author.id, message.author.username);
  const canGive = await checkLevel(uid, LEVEL_REQUIREMENTS.give);
  if (!canGive) {
    await message.reply(`You need to be **Level ${LEVEL_REQUIREMENTS.give}** to give cards. Keep summoning and grabbing to level up!`);
    return;
  }

  const target = message.mentions.users.first();
  const code = args.find((a) => !a.startsWith("<@"));

  if (!target || !code) {
    await message.reply(`Usage: \`ka!give <@user> <card code>\``);
    return;
  }

  const { giveCard } = await import("../services/economy.service.js");
  const result = await giveCard(
    message.author.id, message.author.username,
    target.id, target.username,
    code
  );

  if (!result.success) {
    await message.reply(result.reason);
    return;
  }

  await message.reply(`Gave \`${code}\` to **${target.username}**!`);
}

// ─── Trade: k!trade <@user> <your code> <their code> ───

async function handleTrade(message: Message, args: string[]) {
  const { checkLevel, LEVEL_REQUIREMENTS } = await import("../services/level.service.js");
  const uid = await ensureUser(message.author.id, message.author.username);
  const canTrade = await checkLevel(uid, LEVEL_REQUIREMENTS.trade);
  if (!canTrade) {
    await message.reply(`You need to be **Level ${LEVEL_REQUIREMENTS.trade}** to trade cards. Keep summoning and grabbing to level up!`);
    return;
  }
  const { executePrefix } = await import("../commands/economy/trade.js");
  await executePrefix(message, args);
}

// ─── Tag: k!tag <code> <tag> ────────────────────────────

async function handleTag(message: Message, args: string[]) {
  if (args.length < 1) {
    await message.reply(`Usage: \`ka!tag <code> [tag text]\` (empty to remove)`);
    return;
  }

  const code = args[0];
  const tagText = args.slice(1).join(" ").slice(0, 50) || null;

  const userId = await ensureUser(message.author.id, message.author.username);

  const [card] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.code, code), eq(cards.ownerId, userId)))
    .limit(1);

  if (!card) {
    await message.reply(`You don't own card \`${code}\`.`);
    return;
  }

  await db.update(cards).set({ tag: tagText, updatedAt: new Date() }).where(eq(cards.id, card.id));
  await message.reply(tagText ? `Tagged \`${code}\` as "${tagText}".` : `Removed tag from \`${code}\`.`);
}

// ─── Profile: k!p [@user] ───────────────────────────────

async function handleProfile(message: Message, args: string[]) {
  try {
    const target = message.mentions.users.first() ?? message.author;

    const userId = await ensureUser(target.id, target.username);
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        gold: users.gold,
        shards: users.shards,
        cinders: users.cinders,
        opals: users.opals,
        totalSummons: users.totalSummons,
        totalGrabs: users.totalGrabs,
        totalFusions: users.totalFusions,
        totalTrades: users.totalTrades,
        totalGifts: users.totalGifts,
        partnerId: users.partnerId,
        blurb: users.blurb,
        xp: users.xp,
        level: users.level,
        joinedAt: users.joinedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const avatar = target.displayAvatarURL?.() ?? undefined;

    if (!user) {
      await message.reply("User hasn't started playing yet!");
      return;
    }

    const { getLevelInfo } = await import("../services/level.service.js");
    const lvlInfo = await getLevelInfo(user.id);

    const cardCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(cards)
      .where(eq(cards.ownerId, user.id));
    const cardCount = cardCountResult[0]?.count ?? 0;

    // Partner name
    let partnerName = "";
    if (user.partnerId) {
      const [partner] = await db.select({ username: users.username, discordId: users.discordId })
        .from(users).where(eq(users.id, user.partnerId)).limit(1);
      if (partner) partnerName = `<@${partner.discordId}>`;
    }

    // XP progress bar
    const barLen = 10;
    const filled = Math.round(lvlInfo.progress * barLen);
    const progressBar = "█".repeat(filled) + "░".repeat(barLen - filled);

    const joinedTs = Math.floor(user.joinedAt.getTime() / 1000);

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setAuthor({ name: `${target.username}'s Profile`, iconURL: avatar })
      .setThumbnail(avatar ?? null)
      .setDescription(
        `Lvl **${user.level}** · ${progressBar} \`${lvlInfo.xpInLevel}/${lvlInfo.xpForNext}\` **XP**\n\n` +
        (user.blurb ? `*${user.blurb}*\n\n` : "")
      )
      .addFields(
        {
          name: "🃏 __**Cards:**__",
          value: `» Summoned · **${user.totalSummons}**\n` +
            `» Grabbed · **${user.totalGrabs}**\n` +
            `» Fused · **${user.totalFusions}**\n` +
            `» Owned · **${cardCount}**`,
          inline: true,
        },
        {
          name: "🤝 __**Social:**__",
          value: `» Cards given · **${user.totalGifts}**\n` +
            `» Trades · **${user.totalTrades}**\n` +
            (partnerName ? `» Partner · ${partnerName}` : `» Partner · *None*`),
          inline: true,
        },
        {
          name: "💰 __**Economy:**__",
          value: `» Gold · **${user.gold}**\n` +
            `» Shards · **${user.shards}**\n` +
            `» Cinders · **${user.cinders}**`,
          inline: true,
        },
      )
      .setFooter({ text: `Playing since ${user.joinedAt.toLocaleDateString()} · ID: ${target.id}` });

    await message.reply({ embeds: [embed] });
  } catch (err: any) {
    console.error("[Profile] Error:", err);
    await message.reply(`Profile error: ${String(err).slice(0, 200)}`);
  }
}

// ─── Wish: ka!wish list / ka!wish add <name> / etc ──────

async function handleWish(message: Message, args: string[]) {
  const sub = args[0]?.toLowerCase();
  const userId = await ensureUser(message.author.id, message.author.username);
  const { likeList, summonList } = await import("../db/schema.js");

  if (!sub || sub === "list" || sub === "likes") {
    const wishes = await db
      .select({ charName: characters.name, series: characters.series })
      .from(likeList)
      .innerJoin(characters, eq(likeList.characterId, characters.id))
      .where(eq(likeList.userId, userId))
      .limit(25);

    if (wishes.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setAuthor({ name: `${message.author.username}'s Likes`, iconURL: message.author.displayAvatarURL() })
        .setDescription("The list is empty.");
      await message.reply({ embeds: [embed] });
      return;
    }

    const list = wishes.map((w, i) => `${i + 1}. ${w.series} · **${w.charName}**`).join("\n");
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setAuthor({ name: `${message.author.username}'s Likes`, iconURL: message.author.displayAvatarURL() })
      .setDescription(list)
      .setFooter({ text: `${wishes.length} characters` });
    await message.reply({ embeds: [embed] });
  }

  else if (sub === "summonlist" || sub === "sl") {
    const [user] = await db.select({ summonListSlots: users.summonListSlots }).from(users).where(eq(users.discordId, message.author.id)).limit(1);
    const entries = await db
      .select({ charName: characters.name, series: characters.series, slot: summonList.slotNumber })
      .from(summonList)
      .innerJoin(characters, eq(summonList.characterId, characters.id))
      .where(eq(summonList.userId, userId))
      .orderBy(summonList.slotNumber);

    const slots = user?.summonListSlots ?? 5;
    const list = entries.length > 0
      ? entries.map((e) => `${e.slot}. ${e.series} · **${e.charName}**`).join("\n")
      : "The list is empty.";

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setAuthor({ name: `${message.author.username}'s Summon List`, iconURL: message.author.displayAvatarURL() })
      .setDescription(`Available Slots: ${slots - entries.length}/${slots}\n\n${list}`);
    await message.reply({ embeds: [embed] });
  }

  else if (sub === "add" || sub === "likeadd") {
    const name = args.slice(1).join(" ");
    if (!name) { await message.reply(`Usage: \`ka!wish add <character name>\``); return; }

    // Check slot limit
    const [userRow] = await db.select({ likeListSlots: users.likeListSlots })
      .from(users).where(eq(users.id, userId)).limit(1);
    const maxSlots = userRow?.likeListSlots ?? 10;
    const [{ currentCount }] = await db.select({ currentCount: sql<number>`count(*)` })
      .from(likeList).where(eq(likeList.userId, userId));
    if (currentCount >= maxSlots) {
      await message.reply(`Wishlist full (${maxSlots}/${maxSlots}). Remove one first with \`ka!wish remove <name>\`.`);
      return;
    }

    let [char] = await db.select({ id: characters.id, name: characters.name, series: characters.series })
      .from(characters).where(sql`LOWER(${characters.name}) LIKE LOWER(${'%' + name + '%'})`).orderBy(desc(characters.popularity)).limit(1);
    if (!char) { await message.reply(`No character found matching "${name}".`); return; }

    const [existing] = await db.select({ id: likeList.characterId })
      .from(likeList).where(and(eq(likeList.userId, userId), eq(likeList.characterId, char.id))).limit(1);
    if (existing) { await message.reply(`**${char.name}** is already on your wishlist!`); return; }

    await db.insert(likeList).values({ userId, characterId: char.id });
    await message.reply(`Added **${char.name}** (${char.series}) to your likes! (${currentCount + 1}/${maxSlots})`);
  }

  else if (sub === "remove" || sub === "likeremove") {
    const name = args.slice(1).join(" ");
    if (!name) { await message.reply(`Usage: \`ka!wish remove <name or #number>\``); return; }

    // Check if it's a number (remove by position)
    const num = parseInt(name, 10);
    if (!isNaN(num) && num > 0) {
      // Remove by position from their list
      const wishes = await db
        .select({ characterId: likeList.characterId, charName: characters.name })
        .from(likeList)
        .innerJoin(characters, eq(likeList.characterId, characters.id))
        .where(eq(likeList.userId, userId));

      if (num > wishes.length) {
        await message.reply(`You only have ${wishes.length} characters on your wishlist.`);
        return;
      }

      const toRemove = wishes[num - 1];
      await db.delete(likeList).where(and(eq(likeList.userId, userId), eq(likeList.characterId, toRemove.characterId)));
      await message.reply(`Removed **${toRemove.charName}** from your likes.`);
      return;
    }

    // Remove by name — search FROM the user's wishlist, not all characters
    const userWishes = await db
      .select({ characterId: likeList.characterId, charName: characters.name })
      .from(likeList)
      .innerJoin(characters, eq(likeList.characterId, characters.id))
      .where(and(eq(likeList.userId, userId), sql`LOWER(${characters.name}) LIKE LOWER(${'%' + name + '%'})`))
      .limit(1);

    if (userWishes.length === 0) {
      await message.reply(`"${name}" is not on your wishlist.`);
      return;
    }

    await db.delete(likeList).where(and(eq(likeList.userId, userId), eq(likeList.characterId, userWishes[0].characterId)));
    await message.reply(`Removed **${userWishes[0].charName}** from your likes.`);
  }

  else if (sub === "summonadd" || sub === "sla") {
    const name = args.slice(1).join(" ");
    if (!name) { await message.reply(`Usage: \`ka!wish summonadd <character name>\``); return; }

    let [char] = await db.select({ id: characters.id, name: characters.name, series: characters.series })
      .from(characters).where(sql`LOWER(${characters.name}) LIKE LOWER(${'%' + name + '%'})`).orderBy(desc(characters.popularity)).limit(1);
    if (!char) { await message.reply(`No character found matching "${name}".`); return; }

    const [user] = await db.select({ summonListSlots: users.summonListSlots }).from(users).where(eq(users.id, userId)).limit(1);
    const slots = user?.summonListSlots ?? 5;
    const current = await db.select({ id: summonList.characterId }).from(summonList).where(eq(summonList.userId, userId));

    if (current.length >= slots) { await message.reply(`Summon list full (${slots}/${slots}). Remove one first.`); return; }
    if (current.some((c) => c.id === char.id)) { await message.reply(`**${char.name}** is already on your summon list!`); return; }

    await db.insert(summonList).values({ userId, characterId: char.id, slotNumber: current.length + 1 });
    await message.reply(`Added **${char.name}** to summon list (slot ${current.length + 1}/${slots}). 2x summon odds!`);
  }

  else if (sub === "summonremove" || sub === "slr") {
    const name = args.slice(1).join(" ");
    if (!name) { await message.reply(`Usage: \`ka!wish summonremove <character name>\``); return; }

    let [char] = await db.select({ id: characters.id, name: characters.name })
      .from(characters).where(sql`LOWER(${characters.name}) LIKE LOWER(${'%' + name + '%'})`).orderBy(desc(characters.popularity)).limit(1);
    if (!char) { await message.reply(`No character found matching "${name}".`); return; }

    await db.delete(summonList).where(and(eq(summonList.userId, userId), eq(summonList.characterId, char.id)));
    await message.reply(`Removed **${char.name}** from your summon list.`);
  }

  else {
    await message.reply(
      `**Wish commands:**\n` +
      `\`ka!wish list\` — View your likes\n` +
      `\`ka!wish add <name>\` — Add to likes\n` +
      `\`ka!wish remove <name>\` — Remove from likes\n` +
      `\`ka!wish summonlist\` — View summon list\n` +
      `\`ka!wish summonadd <name>\` — Add to summon list\n` +
      `\`ka!wish summonremove <name>\` — Remove from summon list`
    );
  }
}

// ─── Leaderboard: ka!lb ─────────────────────────────────

async function handleLeaderboard(message: Message) {
  const rows = await db
    .select({
      username: users.username,
      totalGrabs: users.totalGrabs,
    })
    .from(users)
    .orderBy(desc(users.totalGrabs))
    .limit(10);

  if (rows.length === 0) {
    await message.reply("No data yet. Start playing!");
    return;
  }

  const list = rows.map((r, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `\`${i + 1}.\``;
    return `${medal} **${r.username}** — ${r.totalGrabs} grabs`;
  }).join("\n");

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🃏 Leaderboard — Most Grabs")
    .setDescription(list)
    .setFooter({ text: "Use /leaderboard for more categories and pagination" });

  await message.reply({ embeds: [embed] });
}

// ─── Shop: ka!shop ──────────────────────────────────────

async function handleShop(message: Message) {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: `${message.author.username}'s Shop`, iconURL: message.author.displayAvatarURL() })
    .setDescription(
      `**Welcome to Kaoru's shop!**\n` +
      `To buy an item, use command \`ka!buy [item]\`\n\n` +
      `🖼️ — Frames (\`/background shop\`)\n` +
      `✨ — Spells (\`/spell list\`)\n` +
      `📦 — Card Packs (\`/openpack\`)\n` +
      `🔼 — Upgrade Quality (\`/upgrade\`)\n\n` +
      `**Prices:**\n` +
      `Standard Pack — **300 gold**\n` +
      `Premium Pack — **25 shards**\n` +
      `Legendary Pack — **100 shards**\n` +
      `Hex Pack — **200 gold**\n` +
      `Sticker Pack — **150 gold**`
    )
    .setFooter({ text: "Use /shop for the interactive version" });

  await message.reply({ embeds: [embed] });
}

// ─── Fusion Board: ka!fb ────────────────────────────────

async function handleFusionBoard(message: Message) {
  const userId = await ensureUser(message.author.id, message.author.username);

  const pile = await db
    .select({
      code: cards.code,
      charName: characters.name,
      series: characters.series,
      quality: cards.quality,
    })
    .from(cards)
    .innerJoin(characters, eq(cards.characterId, characters.id))
    .where(and(eq(cards.ownerId, userId), eq(cards.inFusionPile, true)))
    .limit(10);

  if (pile.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setAuthor({ name: `${message.author.username}'s Fusion Board`, iconURL: message.author.displayAvatarURL() })
      .setDescription("Your fusion board is empty.\nUse `ka!fa <code>` to add cards.");
    await message.reply({ embeds: [embed] });
    return;
  }

  const list = pile.map((c, i) => `${i + 1}. \`${c.code}\` · **${c.charName}** · ${c.series} · ${c.quality}`).join("\n");
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setAuthor({ name: `${message.author.username}'s Fusion Board`, iconURL: message.author.displayAvatarURL() })
    .setDescription(list)
    .setFooter({ text: `${pile.length} cards | Use ka!f to fuse` });

  await message.reply({ embeds: [embed] });
}

// ─── Tags: ka!tags ──────────────────────────────────────

async function handleTags(message: Message) {
  const userId = await ensureUser(message.author.id, message.author.username);

  const taggedCards = await db
    .select({
      tag: cards.tag,
      count: sql<number>`count(*)`,
    })
    .from(cards)
    .where(and(eq(cards.ownerId, userId), sql`${cards.tag} IS NOT NULL`))
    .groupBy(cards.tag);

  if (taggedCards.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setAuthor({ name: `${message.author.username}'s Tags`, iconURL: message.author.displayAvatarURL() })
      .setDescription("You have no tags. Use `ka!tag <code> <name>` to tag a card.");
    await message.reply({ embeds: [embed] });
    return;
  }

  const list = taggedCards
    .map((t) => `**${t.tag}** — ${t.count} card${t.count > 1 ? "s" : ""}`)
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: `${message.author.username}'s Tags`, iconURL: message.author.displayAvatarURL() })
    .setDescription(list)
    .setFooter({ text: `${taggedCards.length} tags` });

  await message.reply({ embeds: [embed] });
}

// ─── Fuse Add: ka!fa <code> [code] [code] ───────────────

async function handleFuseAdd(message: Message, args: string[]) {
  if (args.length === 0) {
    await message.reply(`Usage: \`ka!fa <code>, <code>, <code>\``);
    return;
  }

  // Support comma-separated and space-separated codes
  const codes = args.join(" ").split(/[\s,]+/).map(c => c.trim()).filter(Boolean);

  const { fuseAdd } = await import("../services/fusion.service.js");
  const result = await fuseAdd(message.author.id, message.author.username, codes);

  if (!result.success) {
    await message.reply(result.reason);
    return;
  }

  await message.reply(`Added **${result.added}** card${result.added > 1 ? "s" : ""} to your fusion board.`);
}

// ─── Fuse: ka!f ─────────────────────────────────────────

async function handleFuse(message: Message) {
  const { fuse } = await import("../services/fusion.service.js");
  const result = await fuse(message.author.id, message.author.username);

  if (!result.success) {
    await message.reply(result.reason);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setAuthor({ name: `${message.author.username}'s Fusion`, iconURL: message.author.displayAvatarURL() })
    .setDescription(
      `Fused **${result.fused}** cards!\n\n` +
      `+**${result.goldEarned}** gold\n` +
      `+**${result.cindersEarned}** cinders\n\n` +
      `+**${result.pileAdded}** Fusion Pile entry\n\n` +
      `${result.remaining} cards remaining on board`
    );

  await message.reply({ embeds: [embed] });
}

// ─── Fast Fuse: ka!ff <code> <code> <code> ──────────────

async function handleFastFuse(message: Message, args: string[]) {
  const fusionService = await import("../services/fusion.service.js");

  // Support comma-separated codes
  const codes = args.join(" ").split(/[\s,]+/).map(c => c.trim()).filter(Boolean);

  if (codes.length > 0) {
    // If codes provided, add them first then fuse
    const addResult = await fusionService.fuseAdd(message.author.id, message.author.username, codes);
    if (!addResult.success) {
      await message.reply(addResult.reason);
      return;
    }
  }

  const { fastFuse } = fusionService;
  const result = await fastFuse(message.author.id, message.author.username);

  if (!result.success) {
    await message.reply(result.reason);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setAuthor({ name: `${message.author.username}'s Fast Fusion`, iconURL: message.author.displayAvatarURL() })
    .setDescription(
      `Fused **${result.totalFused}** cards!\n\n` +
      `+**${result.goldEarned}** gold\n` +
      `+**${result.cindersEarned}** cinders\n\n` +
      `+**${result.pileAdded}** Fusion Pile entries\n\n` +
      `${result.remaining} cards remaining on board`
    );

  await message.reply({ embeds: [embed] });
}

// ─── Upgrade: ka!upgrade <code> ─────────────────────────

async function handleUpgrade(message: Message, args: string[]) {
  if (args.length === 0) {
    await message.reply(`Usage: \`ka!upgrade <card code>\``);
    return;
  }

  const { upgradeCard } = await import("../services/economy.service.js");
  const result = await upgradeCard(message.author.id, message.author.username, args[0]);

  if (!result.success) {
    await message.reply(result.reason);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setDescription(
      `Upgraded \`${args[0]}\` to **${result.newQuality}**!\n` +
      `Cost: **${result.cost}** cinders`
    );

  await message.reply({ embeds: [embed] });
}

async function handleAchievements(message: Message) {
  const allAch = await getAchievements(message.author.id);

  if (allAch.length === 0) {
    await message.reply("No achievements found. Start playing to unlock them!");
    return;
  }

  // Sort: unclaimed completed first, then in-progress, then claimed
  allAch.sort((a, b) => {
    const aWeight = a.claimed ? 2 : a.completed ? 0 : 1;
    const bWeight = b.claimed ? 2 : b.completed ? 0 : 1;
    if (aWeight !== bWeight) return aWeight - bWeight;
    return a.achievement.id - b.achievement.id;
  });

  const PAGE_SIZE = 5;
  const totalPages = Math.max(1, Math.ceil(allAch.length / PAGE_SIZE));
  let page = 1;

  const categoryEmojis: Record<string, string> = {
    summon: "\u2728", grab: "\u{1F91A}", trade: "\u{1F91D}",
    fusion: "\u{1F525}", social: "\u{1F493}", collection: "\u{1F3DB}\uFE0F",
  };

  function buildProgressBar(current: number, max: number): string {
    const filled = Math.floor((current / max) * 10);
    const empty = 10 - filled;
    return "\u25B0".repeat(filled) + "\u25B1".repeat(empty);
  }

  function buildPage(p: number): EmbedBuilder {
    const items = allAch.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
    const lines = items.map((item) => {
      const a = item.achievement;
      const bar = buildProgressBar(item.progress, a.requirementValue);
      const status = item.claimed ? "\u2705" : item.completed ? "\u{1F381}" : "\u{1F512}";
      const catEmoji = categoryEmojis[a.category] ?? "";
      const rewardLabel =
        a.rewardType && a.rewardAmount
          ? ` | +${a.rewardAmount} ${a.rewardType}`
          : "";
      return (
        `${status} ${catEmoji} **${a.name}**\n` +
        `${a.description}\n` +
        `${bar} \u00B7 (${item.progress}/${a.requirementValue})${rewardLabel}`
      );
    });

    return new EmbedBuilder()
      .setColor(0x2b2d31)
      .setAuthor({
        name: `${message.author.username}'s Achievements`,
        iconURL: message.author.displayAvatarURL(),
      })
      .setDescription(lines.join("\n\n"))
      .setFooter({ text: `Page ${p}/${totalPages} | Use /achievements claim:<id> to claim` });
  }

  const buildRow = (p: number) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("achp:prev")
        .setLabel("\u25C0")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(p <= 1),
      new ButtonBuilder()
        .setCustomId("achp:page")
        .setLabel(`${p}/${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId("achp:next")
        .setLabel("\u25B6")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(p >= totalPages)
    );

  const msg = await message.reply({
    embeds: [buildPage(page)],
    components: totalPages > 1 ? [buildRow(page)] : [],
  });

  if (totalPages <= 1) return;

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === message.author.id,
    time: 120_000,
  });

  collector.on("collect", async (i) => {
    if (i.customId === "achp:prev") page = Math.max(1, page - 1);
    if (i.customId === "achp:next") page = Math.min(totalPages, page + 1);
    await i.update({ embeds: [buildPage(page)], components: [buildRow(page)] });
  });

  collector.on("end", async () => {
    await msg.edit({ components: [] }).catch(() => {});
  });
}

// ─── Slot Upgrade: ka!slu, ka!lsu ───────────────────────

async function handleSlotUpgrade(message: Message, type: "summon" | "like") {
  const { upgradeSummonSlots, upgradeLikeSlots, getSlotUpgradeInfo } = await import("../services/economy.service.js");

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, message.author.id),
    columns: { summonListSlots: true, likeListSlots: true, gold: true },
  });
  if (!user) { await message.reply("Start playing first by summoning!"); return; }

  const info = type === "summon"
    ? getSlotUpgradeInfo(user.summonListSlots, 5)
    : getSlotUpgradeInfo(user.likeListSlots, 10);

  if (info.atMax) {
    await message.reply(`Your ${type === "summon" ? "summon" : "like"} list is already at max capacity (**${info.currentSlots}** slots).`);
    return;
  }

  const confirm = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("slu:yes").setLabel(`Upgrade (${info.cost!.toLocaleString()} Gold)`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("slu:no").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );

  const label = type === "summon" ? "Summon List" : "Like List";
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`${label} Upgrade`)
    .setDescription(
      `Current slots: **${info.currentSlots}** / ${info.maxSlots}\n` +
      `Cost: **${info.cost!.toLocaleString()} Gold**\n` +
      `Your gold: **${user.gold.toLocaleString()}**`
    );

  const msg = await message.reply({ embeds: [embed], components: [confirm] });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === message.author.id,
    time: 30_000,
  });

  collector.on("collect", async (i) => {
    if (i.customId === "slu:no") {
      await i.update({ content: "Cancelled.", embeds: [], components: [] });
      return;
    }
    const result = type === "summon"
      ? await upgradeSummonSlots(message.author.id, message.author.username)
      : await upgradeLikeSlots(message.author.id, message.author.username);

    if (!result.success) {
      await i.update({ content: result.reason, embeds: [], components: [] });
    } else {
      await i.update({
        content: `**${label}** upgraded to **${result.newSlots}** slots! (−${result.cost.toLocaleString()} Gold)`,
        embeds: [],
        components: [],
      });
    }
  });

  collector.on("end", async (collected) => {
    if (collected.size === 0) await msg.edit({ components: [] }).catch(() => {});
  });
}

// ─── Buffs: ka!buff [buy <id>] ──────────────────────────

async function handleBuff(message: Message, args: string[]) {
  const { BUFFS, buyBuff, getActiveBuffs } = await import("../services/buff.service.js");

  if (args[0]?.toLowerCase() === "buy" && args[1]) {
    const result = await buyBuff(message.author.id, message.author.username, args[1].toLowerCase());
    if (!result.success) {
      await message.reply(result.reason);
      return;
    }
    const mins = Math.ceil(result.buff.durationSec / 60);
    await message.reply(`✨ **${result.buff.name}** activated for **${mins}m**! (−${result.buff.goldCost.toLocaleString()} Gold)\n${result.buff.description}`);
    return;
  }

  const active = await getActiveBuffs(message.author.id);

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setAuthor({ name: `${message.author.username}'s Buffs`, iconURL: message.author.displayAvatarURL() });

  if (active.length > 0) {
    const lines = active.map((a) => {
      const mins = Math.ceil(a.remainingSec / 60);
      return `✨ **${a.buff.name}** — ${a.buff.description} (${mins}m left)`;
    });
    embed.setDescription("**Active Buffs**\n" + lines.join("\n"));
  }

  const shopLines = BUFFS.map((b) => {
    const isActive = active.some((a) => a.buff.id === b.id);
    const mins = Math.ceil(b.durationSec / 60);
    const status = isActive ? " *(active)*" : "";
    return `\`${b.id}\` **${b.name}** — ${b.description}\n  ${b.goldCost.toLocaleString()} Gold · ${mins}m${status}`;
  });

  const current = embed.data.description ?? "";
  embed.setDescription(
    (current ? current + "\n\n" : "") +
    "**Available Buffs** — `ka!buff buy <id>`\n" +
    shopLines.join("\n")
  );

  await message.reply({ embeds: [embed] });
}

// ─── Potions: ka!potion [buy <id>] [use <id> [cardcode]] ─

async function handlePotion(message: Message, args: string[]) {
  const { POTIONS, buyPotion, getAllPotions, useXpPotion, useQualityReroll, useCooldownReset } = await import("../services/potion.service.js");

  const sub = args[0]?.toLowerCase();

  if (sub === "buy" && args[1]) {
    const qty = parseInt(args[2] ?? "1", 10) || 1;
    const result = await buyPotion(message.author.id, message.author.username, args[1].toLowerCase(), qty);
    if (!result.success) { await message.reply(result.reason); return; }
    await message.reply(`🧪 Bought **${qty}x ${result.potion.name}**! (−${result.totalCost.toLocaleString()} Gold) · You now have ${result.newCount}.`);
    return;
  }

  if (sub === "use" && args[1]) {
    const potionId = args[1].toLowerCase();

    if (potionId === "xp_potion" || potionId === "xp") {
      const result = await useXpPotion(message.author.id, message.author.username);
      if (!result.success) { await message.reply(result.reason); return; }
      await message.reply(`📖 Used **XP Elixir**! Gained **${result.xpGained} XP**.`);
      return;
    }

    if (potionId === "quality_reroll" || potionId === "reroll") {
      const code = args[2];
      if (!code) { await message.reply(`Usage: \`ka!potion use reroll <card code>\``); return; }
      const result = await useQualityReroll(message.author.id, message.author.username, code);
      if (!result.success) { await message.reply(result.reason); return; }
      const arrow = result.newQuality === result.oldQuality ? "→" : (result.newQuality > result.oldQuality ? "⬆️" : "⬇️");
      await message.reply(`🎲 Quality rerolled! **${result.oldQuality}** ${arrow} **${result.newQuality}**`);
      return;
    }

    if (potionId === "cooldown_reset" || potionId === "timewarp" || potionId === "reset") {
      const result = await useCooldownReset(message.author.id);
      if (!result.success) { await message.reply(result.reason); return; }
      await message.reply(`⏰ All cooldowns reset!`);
      return;
    }

    await message.reply(`Unknown potion. Use \`ka!potion\` to see available potions.`);
    return;
  }

  const owned = await getAllPotions(message.author.id);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setAuthor({ name: `${message.author.username}'s Potions`, iconURL: message.author.displayAvatarURL() });

  if (owned.length > 0) {
    const lines = owned.map((o) => `🧪 **${o.potion.name}** ×${o.count}`);
    embed.setDescription("**Your Potions**\n" + lines.join("\n"));
  }

  const shopLines = POTIONS.map((p) => {
    const ownedCount = owned.find((o) => o.potion.id === p.id)?.count ?? 0;
    const stock = ownedCount > 0 ? ` *(${ownedCount}/${p.maxStack})*` : "";
    return `\`${p.id}\` **${p.name}** — ${p.description}\n  ${p.goldCost.toLocaleString()} Gold · Max ${p.maxStack}${stock}`;
  });

  const current = embed.data.description ?? "";
  embed.setDescription(
    (current ? current + "\n\n" : "") +
    "**Potion Shop** — `ka!potion buy <id> [qty]` · `ka!potion use <id> [args]`\n" +
    shopLines.join("\n")
  );

  await message.reply({ embeds: [embed] });
}

// ─── Frame Preview: ka!fp <card code> <frame name|id> ───

async function handleFramePreview(message: Message, args: string[]) {
  if (args.length < 2) {
    await message.reply(`Usage: \`ka!fp <card code> <frame name or id>\`\nPreview how a frame looks on your card without equipping it.`);
    return;
  }

  const cardCode = args[0];
  const frameQuery = args.slice(1).join(" ").toLowerCase();

  const { frames } = await import("../db/schema.js");
  const { ilike: il } = await import("drizzle-orm");

  const card = await getCardByCode(cardCode);
  if (!card) { await message.reply(`Card \`${cardCode}\` not found.`); return; }
  if (card.ownerDiscordId !== message.author.id) { await message.reply("You don't own that card."); return; }

  // Try to find frame by numeric id first, then by name
  let frame;
  const numId = parseInt(frameQuery, 10);
  if (!isNaN(numId)) {
    frame = await db.query.frames.findFirst({ where: eq(frames.id, numId) });
  }
  if (!frame) {
    frame = await db.query.frames.findFirst({ where: il(frames.name, `%${frameQuery}%`) });
  }

  if (!frame) {
    const allFrames = await db.select({ id: frames.id, name: frames.name }).from(frames).limit(20);
    const list = allFrames.map((f) => `\`${f.id}\` ${f.name}`).join("\n");
    await message.reply(`Frame not found. Available frames:\n${list || "No frames in the database yet."}`);
    return;
  }

  const ch = message.channel as any;
  const typing = ch.sendTyping?.();

  const { loadCharacterImage, renderCard: render } = await import("../image/renderer.js");
  const fs = await import("fs/promises");

  let frameBuffer: Buffer | undefined;
  try {
    frameBuffer = await fs.readFile(frame.imagePath);
  } catch {
    await typing;
    await message.reply(`Frame image not found on disk for **${frame.name}**.`);
    return;
  }

  let charImage: Buffer;
  try {
    charImage = await loadCharacterImage(card.edition.imagePath);
  } catch {
    await typing;
    await message.reply("Could not load the card's character image.");
    return;
  }

  const img = await render({
    characterImage: charImage,
    name: card.character.name,
    series: card.character.series,
    quality: card.quality,
    printNumber: card.printNumber,
    editionNumber: card.edition.editionNumber,
    frame: frameBuffer,
    tag: card.tag ?? undefined,
    tagEmoji: card.tagEmoji ?? undefined,
  });

  await typing;

  const attachment = new AttachmentBuilder(img, { name: "frame-preview.png" });
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle("🖼️ Frame Preview")
    .setDescription(`**${frame.name}** on \`${card.code}\` ${card.character.name}`)
    .setImage("attachment://frame-preview.png")
    .setFooter({ text: "This is a preview — frame is not applied." });

  await message.reply({ embeds: [embed], files: [attachment] });
}

// ─── Series Completion: ka!sc <series> ──────────────────

async function handleSeriesCompletion(message: Message, args: string[]) {
  if (args.length === 0) {
    await message.reply(`Usage: \`ka!sc <series name>\`\nShows how many characters from a series you've collected.`);
    return;
  }

  const seriesName = args.join(" ");
  const { ilike: il, count: cnt } = await import("drizzle-orm");

  // Get all characters in series
  const allChars = await db
    .select({ id: characters.id, name: characters.name })
    .from(characters)
    .where(il(characters.series, `%${seriesName}%`))
    .orderBy(characters.name)
    .limit(200);

  if (allChars.length === 0) {
    await message.reply(`No characters found for series matching **${seriesName}**.`);
    return;
  }

  const realSeries = await db
    .select({ series: characters.series })
    .from(characters)
    .where(il(characters.series, `%${seriesName}%`))
    .limit(1);
  const seriesDisplay = realSeries[0]?.series ?? seriesName;

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, message.author.id),
    columns: { id: true },
  });

  if (!user) {
    await message.reply("Start playing first by summoning!");
    return;
  }

  // Get character IDs user owns
  const ownedRows = await db
    .select({ characterId: cards.characterId })
    .from(cards)
    .where(and(
      eq(cards.ownerId, user.id),
      sql`${cards.characterId} IN (${sql.join(allChars.map(c => sql`${c.id}`), sql`, `)})`
    ));

  const ownedCharIds = new Set(ownedRows.map(r => r.characterId));
  const ownedCount = new Set([...ownedCharIds]).size;

  const pct = Math.round((ownedCount / allChars.length) * 100);
  const barLen = 20;
  const filled = Math.round((ownedCount / allChars.length) * barLen);
  const bar = "█".repeat(filled) + "░".repeat(barLen - filled);

  const maxShow = 40;
  const charLines = allChars.slice(0, maxShow).map(c => {
    const owned = ownedCharIds.has(c.id);
    return `${owned ? "✅" : "❌"} ${c.name}`;
  });

  if (allChars.length > maxShow) {
    charLines.push(`*...and ${allChars.length - maxShow} more*`);
  }

  const embed = new EmbedBuilder()
    .setColor(pct >= 100 ? 0xf1c40f : 0x3498db)
    .setTitle(`📚 ${seriesDisplay}`)
    .setDescription(
      `**${ownedCount}** / **${allChars.length}** collected (${pct}%)\n` +
      `\`${bar}\`\n\n` +
      charLines.join("\n")
    )
    .setFooter({ text: pct >= 100 ? "🎉 Series complete!" : `${allChars.length - ownedCount} characters remaining` });

  await message.reply({ embeds: [embed] });
}

// ─── Favorite: ka!fav <code> ────────────────────────────

async function handleFavorite(message: Message, args: string[]) {
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, message.author.id),
    columns: { id: true, favoriteCardId: true },
  });
  if (!user) { await message.reply("Start playing first by summoning!"); return; }

  if (args.length === 0 || args[0] === "show") {
    if (!user.favoriteCardId) {
      await message.reply(`No favorite card set. Use \`ka!fav <card code>\` to set one!`);
      return;
    }
    const favCard = await db.query.cards.findFirst({
      where: eq(cards.id, user.favoriteCardId),
      columns: { code: true, quality: true, printNumber: true, characterId: true },
    });
    if (!favCard) {
      await message.reply("Your favorite card no longer exists.");
      return;
    }
    const char = await db.query.characters.findFirst({
      where: eq(characters.id, favCard.characterId),
      columns: { name: true, series: true },
    });
    await message.reply(`⭐ Your favorite: **${char?.name ?? "Unknown"}** (${char?.series ?? "?"}) · \`${favCard.code}\` · #${favCard.printNumber} · ${favCard.quality}`);
    return;
  }

  if (args[0] === "clear" || args[0] === "remove") {
    await db.update(users).set({ favoriteCardId: null as any }).where(eq(users.id, user.id));
    await message.reply("Favorite card cleared.");
    return;
  }

  const code = args[0];
  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, code), eq(cards.ownerId, user.id)),
    columns: { id: true, characterId: true },
  });
  if (!card) { await message.reply(`You don't own card \`${code}\`.`); return; }

  await db.update(users).set({ favoriteCardId: card.id }).where(eq(users.id, user.id));

  const char = await db.query.characters.findFirst({
    where: eq(characters.id, card.characterId),
    columns: { name: true },
  });

  await message.reply(`⭐ **${char?.name ?? "Unknown"}** is now your favorite card!`);
}

// ─── Achievement Info: ka!ai <id or name> ───────────────

async function handleAchievementInfo(message: Message, args: string[]) {
  if (args.length === 0) {
    await message.reply(`Usage: \`ka!ai <achievement code or name>\``);
    return;
  }

  const { achievements, userAchievements } = await import("../db/schema.js");
  const { ilike: il } = await import("drizzle-orm");

  const query = args.join(" ");

  // Try by code first, then by name
  let ach = await db.query.achievements.findFirst({
    where: eq(achievements.code, query.toLowerCase()),
  });
  if (!ach) {
    ach = await db.query.achievements.findFirst({
      where: il(achievements.name, `%${query}%`),
    });
  }
  if (!ach) {
    await message.reply(`Achievement "${query}" not found. Use \`ka!achievements\` to see all.`);
    return;
  }

  // Get user's progress
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, message.author.id),
    columns: { id: true },
  });

  let progress = 0;
  let completed = false;
  let claimed = false;
  if (user) {
    const ua = await db.query.userAchievements.findFirst({
      where: and(eq(userAchievements.userId, user.id), eq(userAchievements.achievementId, ach.id)),
    });
    if (ua) {
      completed = ua.completed;
      claimed = ua.claimed;
    }

    const { getAchievements } = await import("../services/achievement.service.js");
    const allAch = await getAchievements(message.author.id);
    const match = allAch.find(a => a.achievement.id === ach!.id);
    if (match) progress = match.progress;
  }

  const pct = Math.min(100, Math.round((progress / ach.requirementValue) * 100));
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "█".repeat(filled) + "░".repeat(barLen - filled);

  const rewardStr = ach.rewardType && ach.rewardAmount
    ? `${ach.rewardAmount} ${ach.rewardType}`
    : "None";
  const statusStr = completed ? (claimed ? "✅ Completed & Claimed" : "✅ Completed — claim with `/achievements`") : "⏳ In Progress";

  const embed = new EmbedBuilder()
    .setColor(completed ? 0xf1c40f : 0x2b2d31)
    .setTitle(`${ach.badgeEmoji ?? "🏆"} ${ach.name}`)
    .setDescription(
      `${ach.description}\n\n` +
      `**Category:** ${ach.category}\n` +
      `**Requirement:** ${ach.requirementType.replace(/_/g, " ")} — ${ach.requirementValue}\n` +
      `**Reward:** ${rewardStr}\n` +
      `**Status:** ${statusStr}\n\n` +
      `**Progress:** ${progress} / ${ach.requirementValue} (${pct}%)\n` +
      `\`${bar}\``
    )
    .setFooter({ text: `Code: ${ach.code}` });

  await message.reply({ embeds: [embed] });
}

// ─── Albums ─────────────────────────────────────────────

async function handleAlbums(message: Message, args: string[]) {
  const { getUserAlbums } = await import("../services/album.service.js");
  const target = message.mentions.users.first() ?? message.author;
  const albumList = await getUserAlbums(target.id);

  if (albumList.length === 0) {
    await message.reply(
      target.id === message.author.id
        ? `You have no albums. Create one with \`ka!aa <name>\``
        : `${target.username} has no albums.`
    );
    return;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, target.id),
    columns: { maxAlbums: true },
  });

  const lines = albumList.map((a, i) =>
    `\`${i + 1}.\` **${a.name}** — ${a.pageCount} pages · ${a.cardCount} cards`
  );

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: `${target.username}'s Albums`, iconURL: target.displayAvatarURL() })
    .setDescription(lines.join("\n"))
    .setFooter({ text: `${albumList.length}/${user?.maxAlbums ?? 2} albums` });

  await message.reply({ embeds: [embed] });
}

async function handleAlbumView(message: Message, args: string[]) {
  if (args.length === 0) {
    await message.reply(`Usage: \`ka!album <name> [page]\` or \`ka!alb <name> [page]\``);
    return;
  }

  const { getAlbumPage } = await import("../services/album.service.js");
  const { qualityStars: qs } = await import("../utils/codes.js");

  // Last arg might be page number
  let pageNum = 1;
  const lastArg = args[args.length - 1];
  if (/^\d+$/.test(lastArg) && args.length > 1) {
    pageNum = parseInt(lastArg, 10);
    args = args.slice(0, -1);
  }

  const albumName = args.join(" ");
  const result = await getAlbumPage(message.author.id, albumName, pageNum);

  if ("error" in result) {
    await message.reply(result.error);
    return;
  }

  const cardLines = result.cards.length > 0
    ? result.cards.map(c =>
        `\`${c.position}.\` **${c.characterName}** — ${c.series}\n  ${qs(c.quality)} #${c.printNumber} ◎ED${c.editionNumber} \`${c.code}\``
      ).join("\n")
    : "*No cards on this page. Use `ka!albc <album> <page> <pos> <code>` to add.*";

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`📚 ${result.albumName}`)
    .setDescription(cardLines)
    .setFooter({ text: `Page ${result.pageNumber}/${result.totalPages}${result.backgroundId ? ` · BG #${result.backgroundId}` : ""}` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`alb:prev:${result.pageNumber - 1}:${encodeURIComponent(result.albumName)}`)
      .setEmoji("⬅")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(result.pageNumber <= 1),
    new ButtonBuilder()
      .setCustomId(`alb:next:${result.pageNumber + 1}:${encodeURIComponent(result.albumName)}`)
      .setEmoji("➡")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(result.pageNumber >= result.totalPages),
  );

  await message.reply({ embeds: [embed], components: result.totalPages > 1 ? [row] : [] });
}

async function handleAlbumAdd(message: Message, args: string[]) {
  if (args.length === 0) {
    await message.reply(`Usage: \`ka!aa <album name>\``);
    return;
  }
  const { createAlbum } = await import("../services/album.service.js");
  const name = args.join(" ");
  const result = await createAlbum(message.author.id, name);
  if (!result.success) { await message.reply(result.reason); return; }
  await message.reply(`📚 Album **${name}** created! Use \`ka!albc ${name} 1 1 <card code>\` to add cards.`);
}

async function handleAlbumRemove(message: Message, args: string[]) {
  if (args.length === 0) {
    await message.reply(`Usage: \`ka!alr <album name>\``);
    return;
  }
  const { deleteAlbum } = await import("../services/album.service.js");
  const name = args.join(" ");
  const result = await deleteAlbum(message.author.id, name);
  if (!result.success) { await message.reply(result.reason); return; }
  await message.reply(`🗑️ Album **${name}** deleted.`);
}

async function handleAlbumRename(message: Message, args: string[]) {
  const raw = args.join(" ");
  const parts = raw.split(",").map(s => s.trim());
  if (parts.length !== 2) {
    await message.reply(`Usage: \`ka!ar <old name>, <new name>\``);
    return;
  }
  const { renameAlbum } = await import("../services/album.service.js");
  const result = await renameAlbum(message.author.id, parts[0], parts[1]);
  if (!result.success) { await message.reply(result.reason); return; }
  await message.reply(`📚 Album renamed: **${parts[0]}** → **${parts[1]}**`);
}

async function handlePageAdd(message: Message, args: string[]) {
  if (args.length === 0) {
    await message.reply(`Usage: \`ka!pa <album name>\``);
    return;
  }
  const { addPage } = await import("../services/album.service.js");
  const name = args.join(" ");
  const result = await addPage(message.author.id, name);
  if (!result.success) { await message.reply(result.reason); return; }
  await message.reply(`📄 Page **${result.pageNumber}** added to **${name}**.`);
}

async function handlePageRemove(message: Message, args: string[]) {
  if (args.length < 2) {
    await message.reply(`Usage: \`ka!apr <album name> <page number>\``);
    return;
  }
  const pageNum = parseInt(args[args.length - 1], 10);
  const name = args.slice(0, -1).join(" ");
  if (isNaN(pageNum)) { await message.reply("Invalid page number."); return; }

  const { removePage } = await import("../services/album.service.js");
  const result = await removePage(message.author.id, name, pageNum);
  if (!result.success) { await message.reply(result.reason); return; }
  await message.reply(`🗑️ Page ${pageNum} removed from **${name}**.`);
}

async function handleAlbumCard(message: Message, args: string[]) {
  // ka!albc <album name> <page> <position> <card code>
  if (args.length < 4) {
    await message.reply(`Usage: \`ka!albc <album> <page> <position> <code>\`\nPositions 1-8, decimals allowed.`);
    return;
  }

  const code = args[args.length - 1];
  const position = parseFloat(args[args.length - 2]);
  const pageNum = parseInt(args[args.length - 3], 10);
  const albumName = args.slice(0, -3).join(" ");

  if (isNaN(position) || isNaN(pageNum)) {
    await message.reply("Invalid page or position number.");
    return;
  }

  const { addCardToAlbum } = await import("../services/album.service.js");
  const result = await addCardToAlbum(message.author.id, albumName, pageNum, position, code);
  if (!result.success) { await message.reply(result.reason); return; }
  await message.reply(`✅ Card \`${code}\` added to **${albumName}** page ${pageNum} position ${position}.`);
}

async function handleAlbumCardRemove(message: Message, args: string[]) {
  if (args.length < 2) {
    await message.reply(`Usage: \`ka!acr <album name> <card code>\``);
    return;
  }

  const code = args[args.length - 1];
  const albumName = args.slice(0, -1).join(" ");

  const { removeCardFromAlbum } = await import("../services/album.service.js");
  const result = await removeCardFromAlbum(message.author.id, albumName, code);
  if (!result.success) { await message.reply(result.reason); return; }
  await message.reply(`🗑️ Card \`${code}\` removed from **${albumName}**.`);
}

async function handleAlbumBackground(message: Message, args: string[]) {
  if (args.length < 3) {
    await message.reply(`Usage: \`ka!ab <album name> <page|all> <background id>\``);
    return;
  }

  const bgId = parseInt(args[args.length - 1], 10);
  const pageArg = args[args.length - 2];
  const albumName = args.slice(0, -2).join(" ");

  if (isNaN(bgId)) { await message.reply("Invalid background ID."); return; }

  const pageNum = pageArg.toLowerCase() === "all" ? "all" as const : parseInt(pageArg, 10);
  if (typeof pageNum === "number" && isNaN(pageNum)) {
    await message.reply("Invalid page number. Use a number or `all`.");
    return;
  }

  const { setPageBackground } = await import("../services/album.service.js");
  const result = await setPageBackground(message.author.id, albumName, pageNum, bgId);
  if (!result.success) { await message.reply(result.reason); return; }
  await message.reply(`🎨 Background set for **${albumName}** ${pageNum === "all" ? "all pages" : `page ${pageNum}`}.`);
}

async function handleAlbumPageSwap(message: Message, args: string[]) {
  if (args.length < 3) {
    await message.reply(`Usage: \`ka!aps <album name> <page1> <page2>\``);
    return;
  }

  const p2 = parseInt(args[args.length - 1], 10);
  const p1 = parseInt(args[args.length - 2], 10);
  const albumName = args.slice(0, -2).join(" ");

  if (isNaN(p1) || isNaN(p2)) { await message.reply("Invalid page numbers."); return; }

  const { swapPages } = await import("../services/album.service.js");
  const result = await swapPages(message.author.id, albumName, p1, p2);
  if (!result.success) { await message.reply(result.reason); return; }
  await message.reply(`🔄 Swapped pages ${p1} ↔ ${p2} in **${albumName}**.`);
}

// ─── RPG: Teams ─────────────────────────────────────────

async function handleTeams(message: Message, _args: string[]) {
  const { getUserTeams } = await import("../services/team.service.js");
  const teamList = await getUserTeams(message.author.id);

  if (teamList.length === 0) {
    await message.reply(`No teams yet. Create one with \`ka!at <name>\``);
    return;
  }

  const statusEmoji: Record<string, string> = { home: "🏠", questing: "⚔️" };
  const lines = teamList.map(t =>
    `${statusEmoji[t.status] ?? "🏠"} **${t.name}** — Lv${t.level} · ${t.memberCount}/${t.slotsUnlocked} members · ${t.status}`
  );

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: `${message.author.username}'s Teams`, iconURL: message.author.displayAvatarURL() })
    .setDescription(lines.join("\n"))
    .setFooter({ text: `${teamList.length} team(s)` });

  await message.reply({ embeds: [embed] });
}

async function handleTeamView(message: Message, args: string[]) {
  if (args.length === 0) { await message.reply(`Usage: \`ka!team <name>\``); return; }
  const { getTeamDetails, getTeamStats } = await import("../services/team.service.js");
  const name = args.join(" ");
  const result = await getTeamDetails(message.author.id, name);
  if ("error" in result) { await message.reply(result.error); return; }

  const { team, members } = result;
  const stats = getTeamStats(members);

  const memberLines = members.length > 0
    ? members.map(m => {
        const gear = m.gearName ? ` ⚔️${m.gearName}` : "";
        return `\`${m.slot}.\` **${m.characterName}** Lv${m.cardLevel} · ${m.quality}\n  ATK:${m.atk} DEF:${m.def} SPD:${m.spd} HP:${m.hp} LUK:${m.luk}${gear}`;
      }).join("\n")
    : "*No members. Use `ka!am <team> <card code>` to add.*";

  const embed = new EmbedBuilder()
    .setColor(team.status === "questing" ? 0xe74c3c : 0x3498db)
    .setTitle(`⚔️ ${team.name}`)
    .setDescription(
      `**Status:** ${team.status === "questing" ? "⚔️ Questing" : "🏠 Home"}\n` +
      `**Level:** ${team.level} · **Slots:** ${team.memberCount}/${team.slotsUnlocked}\n\n` +
      memberLines + "\n\n" +
      `**Team Totals** — ATK:${stats.atk} DEF:${stats.def} SPD:${stats.spd} HP:${stats.hp} LUK:${stats.luk}`
    );

  await message.reply({ embeds: [embed] });
}

async function handleAddTeam(message: Message, args: string[]) {
  if (args.length === 0) { await message.reply(`Usage: \`ka!at <team name>\``); return; }
  const { createTeam } = await import("../services/team.service.js");
  const name = args.join(" ");
  const result = await createTeam(message.author.id, name);
  if (!result.success) { await message.reply(result.reason); return; }
  await message.reply(`⚔️ Team **${name}** created! Add members with \`ka!am ${name} <card code>\``);
}

async function handleDeleteTeam(message: Message, args: string[]) {
  if (args.length === 0) { await message.reply(`Usage: \`ka!dt <team name>\``); return; }
  const { deleteTeam } = await import("../services/team.service.js");
  const result = await deleteTeam(message.author.id, args.join(" "));
  if (!result.success) { await message.reply(result.reason); return; }
  await message.reply(`🗑️ Team deleted.`);
}

async function handleRenameTeam(message: Message, args: string[]) {
  const raw = args.join(" ");
  const parts = raw.split(",").map(s => s.trim());
  if (parts.length !== 2) { await message.reply(`Usage: \`ka!rt <old name>, <new name>\``); return; }
  const { renameTeam } = await import("../services/team.service.js");
  const result = await renameTeam(message.author.id, parts[0], parts[1]);
  if (!result.success) { await message.reply(result.reason); return; }
  await message.reply(`⚔️ Team renamed: **${parts[0]}** → **${parts[1]}**`);
}

async function handleAddMember(message: Message, args: string[]) {
  if (args.length < 2) { await message.reply(`Usage: \`ka!am <team name> <card code> [slot]\``); return; }
  const { addTeamMember } = await import("../services/team.service.js");

  const cardCode = args[args.length - 1];
  let slot: number | undefined;
  let teamArgs = args.slice(0, -1);

  // Check if second-to-last arg is a slot number
  const maybeSlot = parseInt(args[args.length - 2], 10);
  if (!isNaN(maybeSlot) && maybeSlot >= 1 && maybeSlot <= 4 && args.length >= 3) {
    slot = maybeSlot;
    teamArgs = args.slice(0, -2);
  }

  const teamName = teamArgs.join(" ");
  const result = await addTeamMember(message.author.id, teamName, cardCode, slot);
  if (!result.success) { await message.reply(result.reason); return; }
  await message.reply(`✅ Card \`${cardCode}\` added to **${teamName}** in slot ${result.slot}.`);
}

async function handleRemoveMember(message: Message, args: string[]) {
  if (args.length < 2) { await message.reply(`Usage: \`ka!rm <team name> <card code>\``); return; }
  const { removeTeamMember } = await import("../services/team.service.js");
  const cardCode = args[args.length - 1];
  const teamName = args.slice(0, -1).join(" ");
  const result = await removeTeamMember(message.author.id, teamName, cardCode);
  if (!result.success) { await message.reply(result.reason); return; }
  await message.reply(`🗑️ Card \`${cardCode}\` removed from **${teamName}**.`);
}

async function handleCardStats(message: Message, args: string[]) {
  if (args.length === 0) { await message.reply(`Usage: \`ka!stats <card code>\``); return; }

  const card = await db
    .select({
      code: cards.code, quality: cards.quality, printNumber: cards.printNumber,
      cardLevel: cards.cardLevel, cardXp: cards.cardXp,
      atk: cards.statAtk, def: cards.statDef, spd: cards.statSpd, hp: cards.statHp, luk: cards.statLuk,
      unspent: cards.unspentPoints,
      charName: characters.name, charSeries: characters.series,
      edNum: characterEditions.editionNumber,
    })
    .from(cards)
    .innerJoin(characters, eq(cards.characterId, characters.id))
    .innerJoin(characterEditions, eq(cards.editionId, characterEditions.id))
    .where(and(eq(cards.code, args[0]), eq(cards.ownerId, (await db.query.users.findFirst({ where: eq(users.discordId, message.author.id), columns: { id: true } }))!.id)))
    .limit(1);

  if (card.length === 0) { await message.reply(`You don't own card \`${args[0]}\`.`); return; }

  const c = card[0];
  const totalStats = c.atk + c.def + c.spd + c.hp + c.luk;

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`📊 ${c.charName} — \`${c.code}\``)
    .setDescription(
      `${c.charSeries} · ◎ED${c.edNum} · #${c.printNumber} · ${c.quality}\n\n` +
      `**Card Level:** ${c.cardLevel} · **XP:** ${c.cardXp}\n` +
      `**Unspent Points:** ${c.unspent}\n\n` +
      `⚔️ ATK: **${c.atk}**\n` +
      `🛡️ DEF: **${c.def}**\n` +
      `💨 SPD: **${c.spd}**\n` +
      `❤️ HP: **${c.hp}**\n` +
      `🍀 LUK: **${c.luk}**\n\n` +
      `Total: **${totalStats}**`
    );

  await message.reply({ embeds: [embed] });
}

// ─── RPG: Quests ────────────────────────────────────────

async function handleQuestList(message: Message) {
  const { getQuestList } = await import("../services/quest.service.js");
  const questList = await getQuestList(message.author.id);

  if (questList.length === 0) {
    await message.reply("No quests available yet. Check back later!");
    return;
  }

  const diffEmoji: Record<string, string> = { easy: "🟢", medium: "🟡", hard: "🔴" };
  const lines = questList.map(q =>
    `\`${q.id}.\` ${diffEmoji[q.difficulty] ?? "⚪"} **${q.name}** — ${q.location}\n  Lv${q.requiredLevel} · ${q.durationMinutes}m · ${q.rewardGold}g ${q.rewardShards}s ${q.rewardCinders}c`
  );

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle("📜 Quest Board")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `${questList.length} quests · ka!qi <id> for details · ka!q <id> <team> to start` });

  await message.reply({ embeds: [embed] });
}

async function handleQuestInfo(message: Message, args: string[]) {
  if (args.length === 0) { await message.reply(`Usage: \`ka!qi <quest id>\``); return; }
  const { getQuestInfo } = await import("../services/quest.service.js");
  const id = parseInt(args[0], 10);
  if (isNaN(id)) { await message.reply("Invalid quest ID."); return; }

  const quest = await getQuestInfo(id);
  if (!quest) { await message.reply("Quest not found."); return; }

  const diffEmoji: Record<string, string> = { easy: "🟢", medium: "🟡", hard: "🔴" };
  const statLines = Object.entries(quest.recommendedStats)
    .map(([k, v]) => `${k.toUpperCase()}: ${v}`)
    .join(" · ");

  const embed = new EmbedBuilder()
    .setColor(quest.difficulty === "hard" ? 0xe74c3c : quest.difficulty === "medium" ? 0xf1c40f : 0x2ecc71)
    .setTitle(`${diffEmoji[quest.difficulty] ?? "⚪"} ${quest.name}`)
    .setDescription(
      `*${quest.description}*\n\n` +
      `**Location:** ${quest.location}\n` +
      `**Difficulty:** ${quest.difficulty}\n` +
      `**Required Level:** ${quest.requiredLevel}\n` +
      `**Duration:** ${quest.durationMinutes}m\n` +
      (quest.favoredStat ? `**Favored Stat:** ${quest.favoredStat.toUpperCase()}\n` : "") +
      (statLines ? `**Recommended:** ${statLines}\n` : "") +
      `\n**Rewards:**\n` +
      `  💰 ${quest.rewardGold} Gold · ✨ ${quest.rewardShards} Shards · 🔥 ${quest.rewardCinders} Cinders\n` +
      `  *(First clear: double rewards!)*`
    );

  await message.reply({ embeds: [embed] });
}

async function handleStartQuest(message: Message, args: string[]) {
  if (args.length < 2) { await message.reply(`Usage: \`ka!q <quest id> <team name>\``); return; }
  const { startQuest } = await import("../services/quest.service.js");

  const questId = parseInt(args[0], 10);
  if (isNaN(questId)) { await message.reply("Invalid quest ID."); return; }
  const teamName = args.slice(1).join(" ");

  const result = await startQuest(message.author.id, questId, teamName);
  if (!result.success) { await message.reply(result.reason); return; }

  const pct = Math.round(result.successChance * 100);
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`⚔️ Quest Started!`)
    .setDescription(
      `**${result.questName}** with team **${result.teamName}**\n\n` +
      `**Success Chance:** ${pct}%\n` +
      `**Duration:** ${result.durationMin}m\n` +
      `**Returns:** <t:${Math.floor(result.endsAt.getTime() / 1000)}:R>\n\n` +
      `Use \`ka!cq ${result.teamName}\` when the quest is done.`
    );

  await message.reply({ embeds: [embed] });
}

async function handleActiveQuests(message: Message) {
  const { getActiveQuests } = await import("../services/quest.service.js");
  const active = await getActiveQuests(message.author.id);

  if (active.length === 0) {
    await message.reply("No active quests. Use `ka!ql` to see available quests.");
    return;
  }

  const lines = active.map(q => {
    const timeStr = q.remainingMinutes > 0
      ? `${q.remainingMinutes}m remaining`
      : "✅ Ready to complete!";
    return `⚔️ **${q.questName}** — team **${q.teamName}**\n  ${Math.round(q.successChance * 100)}% chance · ${timeStr}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("🗡️ Active Quests")
    .setDescription(lines.join("\n\n"))
    .setFooter({ text: `ka!cq <team> to complete · ka!qr <team> to cancel` });

  await message.reply({ embeds: [embed] });
}

async function handleCompleteQuest(message: Message, args: string[]) {
  if (args.length === 0) { await message.reply(`Usage: \`ka!cq <team name>\``); return; }
  const { completeQuest } = await import("../services/quest.service.js");
  const teamName = args.join(" ");
  const result = await completeQuest(message.author.id, teamName);

  if (!result.success) { await message.reply(result.reason); return; }

  if (!result.won) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle(`❌ Quest Failed — ${result.questName}`)
      .setDescription(result.failureMessage ?? "Better luck next time.");
    await message.reply({ embeds: [embed] });
    return;
  }

  const r = result.rewards!;
  const bonus = r.firstClearBonus ? " *(First clear: 2x rewards!)*" : "";
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`✅ Quest Complete — ${result.questName}`)
    .setDescription(
      `**Rewards:**${bonus}\n` +
      `💰 ${r.gold} Gold · ✨ ${r.shards} Shards · 🔥 ${r.cinders} Cinders\n` +
      `📈 ${r.xp} Card XP to team members`
    );
  await message.reply({ embeds: [embed] });
}

async function handleQuestReturn(message: Message, args: string[]) {
  if (args.length === 0) { await message.reply(`Usage: \`ka!qr <team name>\``); return; }
  const { cancelQuest } = await import("../services/quest.service.js");
  const result = await cancelQuest(message.author.id, args.join(" "));
  if (!result.success) { await message.reply(result.reason); return; }
  await message.reply(`🏠 Team returned from **${result.questName}**. No rewards earned.`);
}
