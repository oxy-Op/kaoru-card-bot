import { db } from "../db/index.js";
import { likeList, users } from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";
import { redis } from "../cache/index.js";
import type { Client, Guild } from "discord.js";

/** Max one DM per user per character per this many seconds (spam guard). */
const NOTIFY_COOLDOWN_SEC = 600; // 10 minutes

function notifyKey(userId: number, characterId: number): string {
  return `sw_notify:${userId}:${characterId}`;
}

async function resolveGuild(
  client: Client,
  guildId: string
): Promise<Guild | undefined> {
  const cached = client.guilds.cache.get(guildId);
  if (cached) return cached;
  try {
    return await client.guilds.fetch(guildId);
  } catch {
    return undefined;
  }
}

/**
 * Returns whether the Discord user is a member of the guild (they already see the summon).
 */
async function isGuildMember(
  guild: Guild,
  discordUserId: string,
  cache: Map<string, boolean>
): Promise<boolean> {
  const hit = cache.get(discordUserId);
  if (hit !== undefined) return hit;

  if (guild.members.cache.has(discordUserId)) {
    cache.set(discordUserId, true);
    return true;
  }

  try {
    await guild.members.fetch({ user: discordUserId });
    cache.set(discordUserId, true);
    return true;
  } catch {
    cache.set(discordUserId, false);
    return false;
  }
}

/**
 * DM users whose wishlist (`likeList`) includes any of the summoned characters.
 * Skips members already in the summon guild and applies per-user-per-character Redis cooldown.
 */
export async function notifySummonWatchers(
  client: Client,
  characterIds: number[],
  guildId: string,
  channelId: string,
  characterNames: Map<number, string>
): Promise<void> {
  if (characterIds.length === 0) return;

  const watchers = await db
    .select({
      userId: likeList.userId,
      characterId: likeList.characterId,
      discordId: users.discordId,
    })
    .from(likeList)
    .innerJoin(users, eq(likeList.userId, users.id))
    .where(inArray(likeList.characterId, characterIds));

  if (watchers.length === 0) return;

  const guild = await resolveGuild(client, guildId);
  const channel = guild?.channels.cache.get(channelId);
  const channelName =
    channel && channel.isTextBased() && "name" in channel
      ? channel.name
      : "unknown";
  const guildName = guild?.name ?? "a server";

  const memberCache = new Map<string, boolean>();

  for (const watcher of watchers) {
    if (guild && (await isGuildMember(guild, watcher.discordId, memberCache))) {
      continue;
    }

    const rlKey = notifyKey(watcher.userId, watcher.characterId);
    try {
      const exists = await redis.exists(rlKey);
      if (exists) continue;
    } catch {
      continue;
    }

    const charName =
      characterNames.get(watcher.characterId) ?? "A character";

    try {
      const discordUser = await client.users.fetch(watcher.discordId);
      await discordUser.send(
        `💖 **${charName}** from your wishlist was just summoned! Check **#${channelName}** in **${guildName}**.`
      );
      await redis.set(rlKey, "1", "EX", NOTIFY_COOLDOWN_SEC);
    } catch {
      // DMs closed, user unreachable, etc.
    }
  }
}

/**
 * Run wishlist notifications without blocking the caller or failing the summon flow.
 */
export function scheduleSummonWatchNotifications(
  client: Client,
  characterIds: number[],
  guildId: string,
  channelId: string,
  characterNames: Map<number, string>
): void {
  void notifySummonWatchers(
    client,
    characterIds,
    guildId,
    channelId,
    characterNames
  ).catch(() => {});
}
