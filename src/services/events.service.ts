import { db } from "../db/index.js";
import { events, eventCards, cards, users, characters, characterEditions } from "../db/schema.js";
import { eq, and, sql, gte, lte, count } from "drizzle-orm";
import { ensureUser } from "./summon.service.js";
import { newCardCode, rollQuality } from "../utils/codes.js";

export interface ActiveEvent {
  id: number;
  name: string;
  description: string;
  startDate: Date;
  endDate: Date;
  bannerUrl: string | null;
  rewardMultiplier: number;
}

/** Get the currently active event, if any. */
export async function getActiveEvent(): Promise<ActiveEvent | null> {
  const now = new Date();
  const event = await db.query.events.findFirst({
    where: and(
      lte(events.startDate, now),
      gte(events.endDate, now),
      eq(events.active, true)
    ),
  });
  return event ?? null;
}

/** Get all event-exclusive cards for an event. */
export async function getEventCards(eventId: number) {
  return db
    .select({
      id: eventCards.id,
      characterId: eventCards.characterId,
      editionId: eventCards.editionId,
      dropWeight: eventCards.dropWeight,
      charName: characters.name,
      charSeries: characters.series,
    })
    .from(eventCards)
    .innerJoin(characters, eq(eventCards.characterId, characters.id))
    .where(eq(eventCards.eventId, eventId));
}

/** Roll an event card during a summon (if event is active). */
export async function rollEventCard(
  eventId: number,
  discordUserId: string,
  username: string,
  guildId: string
): Promise<{ code: string; characterName: string; series: string } | null> {
  const pool = await getEventCards(eventId);
  if (pool.length === 0) return null;

  // Weighted random from event pool
  const totalWeight = pool.reduce((sum, c) => sum + c.dropWeight, 0);
  let roll = Math.random() * totalWeight;
  let picked = pool[0];
  for (const card of pool) {
    roll -= card.dropWeight;
    if (roll <= 0) { picked = card; break; }
  }

  const userId = await ensureUser(discordUserId, username);
  const code = newCardCode();
  const quality = rollQuality();

  // Get next print for this edition
  const [printResult] = await db
    .select({ maxPrint: sql<number>`COALESCE(MAX(${cards.printNumber}), 0)` })
    .from(cards)
    .where(eq(cards.editionId, picked.editionId));
  const printNumber = (printResult?.maxPrint ?? 0) + 1;

  await db.insert(cards).values({
    code,
    characterId: picked.characterId,
    editionId: picked.editionId,
    printNumber,
    quality,
    originalQuality: quality,
    summonerId: userId,
    ownerId: userId, // Event cards go directly to the user
    guildId,
    isEventCard: true,
    eventId,
  });

  return { code, characterName: picked.charName, series: picked.charSeries };
}

/** Create a new seasonal event. */
export async function createEvent(data: {
  name: string;
  description: string;
  startDate: Date;
  endDate: Date;
  bannerUrl?: string;
  rewardMultiplier?: number;
}) {
  const [created] = await db.insert(events).values({
    name: data.name,
    description: data.description,
    startDate: data.startDate,
    endDate: data.endDate,
    bannerUrl: data.bannerUrl ?? null,
    rewardMultiplier: data.rewardMultiplier ?? 1.5,
    active: true,
  }).returning();
  return created;
}

/** Add a character to an event's exclusive card pool. */
export async function addEventCard(eventId: number, characterId: number, editionId: number, dropWeight: number = 1.0) {
  await db.insert(eventCards).values({ eventId, characterId, editionId, dropWeight });
}
