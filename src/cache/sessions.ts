import { redis } from "./index.js";

const GRAB_LOCK_TTL = 60; // lock expires after 60s (card unclaimed)

/**
 * Attempt to grab a card. Returns true if this user won the grab.
 * Uses Redis SETNX for atomic race condition handling.
 */
export async function attemptGrab(
  summonId: string,
  userId: string
): Promise<boolean> {
  const key = `grab:${summonId}`;
  // SETNX: only sets if key doesn't exist — first caller wins
  const result = await redis.set(key, userId, "EX", GRAB_LOCK_TTL, "NX");
  return result === "OK";
}

/** Get who grabbed a summon (if anyone). */
export async function getGrabWinner(
  summonId: string
): Promise<string | null> {
  return redis.get(`grab:${summonId}`);
}

/**
 * For activity summons: collect all grab attempts, then pick winner randomly.
 * Returns the winning userId.
 */
export async function collectGrabAttempts(
  summonId: string,
  userId: string
): Promise<void> {
  const key = `grab_pool:${summonId}`;
  await redis.sadd(key, userId);
  await redis.expire(key, GRAB_LOCK_TTL);
}

export async function pickRandomGrabWinner(
  summonId: string
): Promise<string | null> {
  const key = `grab_pool:${summonId}`;
  const member = await redis.srandmember(key);
  return member;
}

/** Clean up grab state after card is claimed or expired. */
export async function clearGrab(summonId: string): Promise<void> {
  await redis.del(`grab:${summonId}`, `grab_pool:${summonId}`);
}
