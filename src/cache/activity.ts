import { redis } from "./index.js";

const ACTIVITY_WINDOW_SEC = 120; // track messages within 2 min windows
const SPAWN_PROBABILITY = 0.15; // 15% chance when threshold met
const SPAWN_LOCK_SEC = 600; // 10 min between spawns per channel

/**
 * Record a message in a guild channel and check if activity spawn should trigger.
 * Returns true if a spawn should happen.
 *
 * Default threshold is 15 messages from 3+ unique users.
 * Admins can configure via /setchannel and activity_threshold in guild config.
 */
export async function trackActivity(
  guildId: string,
  channelId: string,
  userId: string,
  threshold: number
): Promise<boolean> {
  const activityKey = `activity:${guildId}:${channelId}`;
  const userKey = `activity_user:${guildId}:${channelId}`;
  const spawnLockKey = `activity_spawn_lock:${guildId}:${channelId}`;

  // Track unique users (not just message count — prevents spam gaming)
  await redis.sadd(userKey, userId);
  await redis.expire(userKey, ACTIVITY_WINDOW_SEC);

  // Increment message counter
  const count = await redis.incr(activityKey);
  if (count === 1) {
    await redis.expire(activityKey, ACTIVITY_WINDOW_SEC);
  }

  // Check unique user count
  const uniqueUsers = await redis.scard(userKey);

  // Need both message volume AND unique users above threshold
  // Default: 15 messages from 3+ unique users
  const minUsers = Math.max(3, Math.floor(threshold / 3));
  if (count >= threshold && uniqueUsers >= minUsers) {
    // Prevent rapid-fire spawns: 10 min between activity spawns per channel
    const locked = await redis.set(spawnLockKey, "1", "EX", SPAWN_LOCK_SEC, "NX");
    if (!locked) return false;

    // Random chance — not every threshold hit spawns
    if (Math.random() > SPAWN_PROBABILITY) return false;

    // Reset counters
    await redis.del(activityKey, userKey);
    return true;
  }

  return false;
}
