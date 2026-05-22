import { db } from "../db/index.js";
import { users, backgrounds, userBackgrounds } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { ensureUser } from "./summon.service.js";

/** List all available backgrounds in the shop. */
export async function listBackgrounds() {
  return db.query.backgrounds.findMany({
    orderBy: (bg, { asc }) => [asc(bg.cost)],
  });
}

/** Get backgrounds owned by a user. */
export async function getUserBackgrounds(discordId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, discordId),
    columns: { id: true },
  });
  if (!user) return [];

  return db
    .select({
      bgId: backgrounds.id,
      name: backgrounds.name,
      imagePath: backgrounds.imagePath,
      rarity: backgrounds.rarity,
    })
    .from(userBackgrounds)
    .innerJoin(backgrounds, eq(userBackgrounds.backgroundId, backgrounds.id))
    .where(eq(userBackgrounds.userId, user.id));
}

/** Buy a background. */
export async function buyBackground(
  discordId: string, username: string, bgId: number
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, username);

  const bg = await db.query.backgrounds.findFirst({ where: eq(backgrounds.id, bgId) });
  if (!bg) return { success: false, reason: "Background not found." };

  // Check if already owned
  const owned = await db.query.userBackgrounds.findFirst({
    where: and(eq(userBackgrounds.userId, userId), eq(userBackgrounds.backgroundId, bgId)),
  });
  if (owned) return { success: false, reason: "You already own this background." };

  // Check gold
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { gold: true } });
  if (!user || user.gold < bg.cost) {
    return { success: false, reason: `Need **${bg.cost} gold**. You have ${user?.gold ?? 0}.` };
  }

  await db.update(users).set({ gold: sql`${users.gold} - ${bg.cost}` }).where(eq(users.id, userId));
  await db.insert(userBackgrounds).values({ userId, backgroundId: bgId });

  return { success: true };
}

/** Equip a background to profile. */
export async function equipBackground(
  discordId: string, username: string, bgId: number
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, username);

  const owned = await db.query.userBackgrounds.findFirst({
    where: and(eq(userBackgrounds.userId, userId), eq(userBackgrounds.backgroundId, bgId)),
  });
  if (!owned) return { success: false, reason: "You don't own this background." };

  await db.update(users).set({ activeBackgroundId: bgId }).where(eq(users.id, userId));
  return { success: true };
}
