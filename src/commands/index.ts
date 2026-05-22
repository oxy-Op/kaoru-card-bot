import {
  Collection,
  REST,
  Routes,
  type ChatInputCommandInteraction,
} from "discord.js";
import { config } from "../config.js";

// Play
import * as summon from "./play/summon.js";
import * as view from "./play/view.js";
import * as collection from "./play/collection.js";
import * as lookup from "./play/lookup.js";
import * as cardinfo from "./play/cardinfo.js";
import * as cooldown from "./play/cooldown.js";
import * as alarm from "./play/alarm.js";
import * as tag from "./play/tag.js";
import * as leaderboard from "./play/leaderboard.js";
import * as wish from "./play/wish.js";
import * as event from "./play/event.js";
import * as achievements from "./play/achievements.js";

// Economy
import * as daily from "./economy/daily.js";
import * as balance from "./economy/balance.js";
import * as give from "./economy/give.js";
import * as trade from "./economy/trade.js";
import * as upgrade from "./economy/upgrade.js";
import * as shop from "./economy/shop.js";
import * as buy from "./economy/buy.js";
import * as multitrade from "./economy/multitrade.js";
import * as vote from "./economy/vote.js";
import * as givecosmetic from "./economy/givecosmetic.js";
import * as openpack from "./economy/openpack.js";
import * as bounty from "./economy/bounty.js";
import * as auction from "./economy/auction.js";

// Fusion
import * as fusionboard from "./fusion/fusionboard.js";
import * as fuseadd from "./fusion/fuseadd.js";
import * as fuse from "./fusion/fuse.js";
import * as fastfuse from "./fusion/fastfuse.js";

// Cosmetics
import * as cosmeticsInv from "./cosmetics/inventory.js";
import * as use from "./cosmetics/use.js";
import * as removehex from "./cosmetics/removehex.js";
import * as removeaura from "./cosmetics/removeaura.js";
import * as removeframe from "./cosmetics/removeframe.js";
import * as stick from "./cosmetics/stick.js";
import * as open from "./cosmetics/open.js";
import * as spell from "./cosmetics/spell.js";

// Profile
import * as profile from "./profile/profile.js";
import * as blurb from "./profile/blurb.js";
import * as profileset from "./profile/customize.js";
import * as background from "./profile/background.js";

// Social
import * as partner from "./social/partner.js";
import * as divorce from "./social/divorce.js";
import * as giftcard from "./social/giftcard.js";
import * as giftsCmd from "./social/gifts.js";
import * as mailCmd from "./social/mail.js";

// Settings
import * as prefix from "./settings/prefix.js";
import * as setchannel from "./settings/setchannel.js";
import * as antisnipe from "./settings/antisnipe.js";
import * as restrict from "./settings/restrict.js";

// Admin
import * as grant from "./admin/grant.js";
import * as spawn from "./admin/spawn.js";
import * as browse from "./admin/browse.js";
import * as review from "./admin/review.js";

// Player
import * as inventory from "./player/inventory.js";
import * as userinfo from "./player/userinfo.js";
import * as seriesmatch from "./player/seriesmatch.js";
import * as content from "./player/content.js";
import * as privacyCmd from "./player/private.js";
import * as badgesCmd from "./player/badges.js";
import * as likematch from "./player/likematch.js";
import * as cg from "./player/cg.js";

// Economy (new)
import * as burn from "./economy/burn.js";

// Play (new)
import * as completeachievement from "./play/completeachievement.js";

// Tags
import * as tagadd from "./tags/tagadd.js";
import * as tagremove from "./tags/tagremove.js";
import * as tagrename from "./tags/tagrename.js";
import * as tagreemote from "./tags/tagreemote.js";
import * as untag from "./tags/untag.js";
import * as taglist from "./tags/taglist.js";

// Minigames
import * as trivia from "./minigames/trivia.js";
import * as guess from "./minigames/guess.js";
import * as rps from "./minigames/rps.js";
import * as fish from "./minigames/fishing.js";

interface Command {
  data: { name: string; toJSON: () => unknown };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const commands = new Collection<string, Command>();

const allCommands: Command[] = [
  // Play
  summon, view, collection, lookup, cardinfo, cooldown, alarm, tag, leaderboard, wish, event, achievements,
  // Economy
  daily, balance, give, trade, multitrade, upgrade, shop, buy, vote, givecosmetic, openpack, bounty, auction,
  // Fusion
  fusionboard, fuseadd, fuse, fastfuse,
  // Cosmetics
  cosmeticsInv, use, removehex, removeaura, removeframe, stick, open, spell,
  // Profile
  profile, blurb, profileset, background,
  // Social
  partner, divorce, giftcard, giftsCmd, mailCmd,
  // Settings
  prefix, setchannel, antisnipe, restrict,
  // Admin
  grant, spawn, browse, review,
  // Player
  inventory, userinfo, seriesmatch, content, privacyCmd, badgesCmd, likematch, cg,
  // Economy (new)
  burn, completeachievement,
  // Tags
  tagadd, tagremove, tagrename, tagreemote, untag, taglist,
  // Minigames
  trivia, guess, rps, fish,
];

for (const cmd of allCommands) {
  commands.set(cmd.data.name, cmd);
}

export { commands };

export async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
  const body = allCommands.map((cmd) => cmd.data.toJSON());

  if (config.DISCORD_DEV_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_DEV_GUILD_ID),
      { body }
    );
    console.log(`[Commands] Registered ${body.length} guild commands (dev guild)`);
  } else {
    await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), { body });
    console.log(`[Commands] Registered ${body.length} global commands`);
  }
}

export const prefixAliases: Record<string, string> = {
  // Play
  s: "summon", summon: "summon",
  v: "view", view: "view",
  c: "collection", col: "collection", collection: "collection",
  lu: "lookup", li: "lookup", lookup: "lookup",
  ci: "cardinfo", cardinfo: "cardinfo",
  cd: "cooldown", cooldown: "cooldown",
  tag: "tag",
  tags: "taglist",
  lb: "leaderboard", leaderboard: "leaderboard",
  wish: "wish", wl: "wish", wa: "wishadd", wr: "wishremove",
  event: "event",
  // Economy
  daily: "daily",
  bal: "balance", balance: "balance",
  give: "give",
  trade: "trade",
  mt: "multitrade", multitrade: "multitrade",
  vote: "vote",
  bounty: "bounty",
  auction: "auction", ah: "auction",
  upgrade: "upgrade",
  shop: "shop",
  buy: "buy",
  buff: "buff", buffs: "buff",
  potion: "potion", potions: "potion", pot: "potion",
  slu: "slu", summonlistupgrade: "slu",
  lsu: "lsu", llu: "lsu", likelistupgrade: "lsu",
  // Fusion
  fb: "fusionboard", fusionboard: "fusionboard",
  fa: "fuseadd", fuseadd: "fuseadd",
  f: "fuse", fuse: "fuse",
  ff: "fastfuse", fastfuse: "fastfuse",
  givecosmetic: "givecosmetic", gc: "givecosmetic",
  openpack: "openpack", pack: "openpack",
  // Cosmetics
  fp: "framepreview", framepreview: "framepreview",
  sc: "seriescompletion", seriescompletion: "seriescompletion",
  fav: "favorite", favorite: "favorite",
  cosmetics: "cosmetics",
  use: "use",
  removehex: "removehex",
  removeaura: "removeaura",
  removeframe: "removeframe",
  stick: "stick",
  open: "open",
  spell: "spell",
  // Profile
  p: "profile", profile: "profile",
  blurb: "blurb",
  profileset: "profileset",
  bg: "background", background: "background",
  // Social
  setchannel: "setchannel", set: "setchannel",
  antisnipe: "antisnipe",
  restrict: "restrict",
  partner: "partner",
  divorce: "divorce",
  gift: "giftcard", giftcard: "giftcard",
  gifts: "gifts",
  mail: "mail",
  // Achievements
  achievements: "achievements", ach: "achievements",
  ai: "achievementinfo", achievementinfo: "achievementinfo",
  guide: "guide",
  invite: "invite",
  // Albums
  albums: "albums",
  album: "album", alb: "album",
  albumadd: "albumadd", aa: "albumadd", albumcreate: "albumadd",
  albumremove: "albumremove", alr: "albumremove",
  renamealbum: "renamealbum", ar: "renamealbum",
  pageadd: "pageadd", pa: "pageadd",
  albumpageremove: "albumpageremove", apr: "albumpageremove",
  albumcard: "albumcard", albc: "albumcard",
  albumcardremove: "albumcardremove", acr: "albumcardremove",
  albumbackground: "albumbackground", ab: "albumbackground",
  albumpageswap: "albumpageswap", aps: "albumpageswap",
  // RPG
  teams: "teams", ts: "teams",
  team: "team",
  addteam: "addteam", at: "addteam",
  deleteteam: "deleteteam", dt: "deleteteam",
  renameteam: "renameteam", rt: "renameteam",
  addmember: "addmember", am: "addmember",
  removemember: "removemember",
  stats: "cardstats", cardstats: "cardstats",
  questlist: "questlist", ql: "questlist",
  questinfo: "questinfo", qi: "questinfo",
  quest: "quest", q: "quest",
  quests: "quests", qs: "quests",
  completequest: "completequest", cq: "completequest",
  questreturn: "questreturn", qr: "questreturn",
  // Player
  i: "inventory", inventory: "inventory",
  ui: "userinfo", userinfo: "userinfo",
  sm: "seriesmatch", seriesmatch: "seriesmatch",
  content: "content",
  pr: "private", private: "private",
  b: "badges", badges: "badges", setbadge: "badges",
  lm: "likematch", likematch: "likematch",
  cg: "cg", cardhunter: "cg", hunt: "cg",
  // Economy (new)
  burn: "burn",
  ca: "completeachievement", completeachievement: "completeachievement",
  // Tags
  ta: "tagadd", tagadd: "tagadd",
  tr: "tagremove", tagremove: "tagremove",
  tagrename: "tagrename",
  tagreemote: "tagreemote",
  ut: "untag", untag: "untag",
  tl: "taglist", taglist: "taglist",
  // Minigames
  trivia: "trivia",
  guess: "guess", mg1: "guess",
  rps: "rps", mg3: "rps",
  fish: "fish", mg4: "fish",
};
