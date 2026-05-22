import { Client } from "discord.js";
import { redis } from "../cache/index.js";
import {
  getCooldown,
  getAllCooldowns,
  type CooldownType,
} from "../cache/cooldowns.js";

export type { CooldownType };

const ALL_TYPES: CooldownType[] = [
  "summon",
  "grab",
  "daily",
  "vote",
  "minigame",
];

const TYPE_LABELS: Record<CooldownType, string> = {
  summon: "Summon",
  grab: "Grab",
  daily: "Daily",
  vote: "Vote",
  minigame: "Minigame",
};

function prefRedisKey(userId: string): string {
  return `alarm:${userId}`;
}

function schedRedisKey(userId: string, type: CooldownType): string {
  return `alarm_sched:${userId}:${type}`;
}

function timeoutMapKey(userId: string, type: CooldownType): string {
  return `${userId}:${type}`;
}

const activeTimeouts = new Map<string, NodeJS.Timeout>();

async function cancelAlarmSchedule(userId: string, type: CooldownType): Promise<void> {
  const mk = timeoutMapKey(userId, type);
  const existing = activeTimeouts.get(mk);
  if (existing) {
    clearTimeout(existing);
    activeTimeouts.delete(mk);
  }
  await redis.del(schedRedisKey(userId, type));
}

async function clearAllAlarmSchedules(userId: string): Promise<void> {
  for (const type of ALL_TYPES) {
    await cancelAlarmSchedule(userId, type);
  }
}

export async function getAlarmPrefs(userId: string): Promise<CooldownType[]> {
  const raw = await redis.get(prefRedisKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const allowed = new Set<CooldownType>(ALL_TYPES);
    return parsed.filter(
      (t): t is CooldownType =>
        typeof t === "string" && allowed.has(t as CooldownType)
    );
  } catch {
    return [];
  }
}

export async function setAlarmPref(
  userId: string,
  type: CooldownType,
  enabled: boolean
): Promise<void> {
  const prefs = await getAlarmPrefs(userId);
  const next = new Set(prefs);
  if (enabled) next.add(type);
  else next.delete(type);
  await redis.set(prefRedisKey(userId), JSON.stringify([...next]));

  if (!enabled) {
    await cancelAlarmSchedule(userId, type);
  }
}

export async function setAllAlarmPrefs(
  userId: string,
  enabled: boolean
): Promise<void> {
  if (enabled) {
    await redis.set(prefRedisKey(userId), JSON.stringify([...ALL_TYPES]));
  } else {
    await redis.set(prefRedisKey(userId), JSON.stringify([]));
    await clearAllAlarmSchedules(userId);
  }
}

export async function scheduleAlarm(
  client: Client,
  userId: string,
  type: CooldownType,
  delaySeconds: number
): Promise<void> {
  if (delaySeconds <= 0) return;

  const mk = timeoutMapKey(userId, type);
  const prev = activeTimeouts.get(mk);
  if (prev) clearTimeout(prev);

  await redis.set(schedRedisKey(userId, type), "1", "EX", delaySeconds);

  const timeout = setTimeout(() => {
    void (async () => {
      activeTimeouts.delete(mk);
      try {
        await redis.del(schedRedisKey(userId, type));
        const prefs = await getAlarmPrefs(userId);
        if (!prefs.includes(type)) return;
        const remaining = await getCooldown(userId, type);
        if (remaining > 0) return;
        const user = await client.users.fetch(userId).catch(() => null);
        if (!user) return;
        const label = TYPE_LABELS[type];
        await user.send(`${label} cooldown is ready!`).catch(() => {});
      } catch {
        // silent
      }
    })();
  }, delaySeconds * 1000);

  activeTimeouts.set(mk, timeout);
}

export async function checkAndScheduleAlarms(
  client: Client,
  userId: string
): Promise<void> {
  const prefs = await getAlarmPrefs(userId);
  if (prefs.length === 0) return;

  const cooldowns = await getAllCooldowns(userId);
  for (const type of prefs) {
    const remaining = cooldowns[type];
    if (remaining > 0) {
      await scheduleAlarm(client, userId, type, remaining);
    }
  }
}
