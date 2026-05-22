import { redis } from "./index.js";
import { config } from "../config.js";

export type CooldownType = "summon" | "grab" | "daily" | "vote" | "minigame";

const COOLDOWN_DURATIONS: Record<CooldownType, number> = {
  summon: config.SUMMON_COOLDOWN_SEC,
  grab: config.GRAB_COOLDOWN_SEC,
  daily: 72000, // 20h
  vote: 43200, // 12h
  minigame: 300, // 5min
};

function key(userId: string, type: CooldownType): string {
  return `cd:${type}:${userId}`;
}

/** Check if a cooldown is active. Returns remaining seconds or 0 if ready. */
export async function getCooldown(
  userId: string,
  type: CooldownType
): Promise<number> {
  const ttl = await redis.ttl(key(userId, type));
  return ttl > 0 ? ttl : 0;
}

/** Set a cooldown. Returns the duration in seconds. */
export async function setCooldown(
  userId: string,
  type: CooldownType,
  customDuration?: number
): Promise<number> {
  const duration = customDuration ?? COOLDOWN_DURATIONS[type];
  await redis.set(key(userId, type), "1", "EX", duration);
  return duration;
}

/** Clear a cooldown (e.g. when using an Extra Summon item). */
export async function clearCooldown(
  userId: string,
  type: CooldownType
): Promise<void> {
  await redis.del(key(userId, type));
}

/** Get all active cooldowns for a user. */
export async function getAllCooldowns(
  userId: string
): Promise<Record<CooldownType, number>> {
  const types: CooldownType[] = ["summon", "grab", "daily", "vote", "minigame"];
  const pipeline = redis.pipeline();

  for (const type of types) {
    pipeline.ttl(key(userId, type));
  }

  const results = await pipeline.exec();
  const cooldowns = {} as Record<CooldownType, number>;

  for (let i = 0; i < types.length; i++) {
    const ttl = results?.[i]?.[1] as number;
    cooldowns[types[i]] = ttl > 0 ? ttl : 0;
  }

  return cooldowns;
}

/** Format seconds into human-readable string. */
export function formatCooldown(seconds: number): string {
  if (seconds <= 0) return "Ready!";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}
