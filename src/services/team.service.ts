import { db } from "../db/index.js";
import { teams, teamMembers, cards, characters, characterEditions, users } from "../db/schema.js";
import { eq, and, sql, count, asc } from "drizzle-orm";
import { ensureUser } from "./summon.service.js";

const MAX_TEAMS_BASE = 1;
const MAX_TEAMS_LV10 = 2;
const ABSOLUTE_MAX_SLOTS = 4;

export interface TeamSummary {
  id: number;
  name: string;
  level: number;
  slotsUnlocked: number;
  status: string;
  memberCount: number;
}

export interface TeamMemberInfo {
  slot: number;
  cardCode: string;
  characterName: string;
  series: string;
  cardLevel: number;
  quality: string;
  atk: number;
  def: number;
  spd: number;
  hp: number;
  luk: number;
  gearName: string | null;
}

export async function getUserTeams(discordId: string): Promise<TeamSummary[]> {
  const userId = await ensureUser(discordId, "");
  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      level: teams.level,
      slotsUnlocked: teams.slotsUnlocked,
      status: teams.status,
      memberCount: sql<number>`(SELECT count(*) FROM team_members WHERE team_id = ${teams.id})`,
    })
    .from(teams)
    .where(eq(teams.userId, userId))
    .orderBy(teams.createdAt);
  return rows;
}

export async function getTeamDetails(
  discordId: string,
  teamName: string
): Promise<{ team: TeamSummary; members: TeamMemberInfo[] } | { error: string }> {
  const userId = await ensureUser(discordId, "");

  const team = await db.query.teams.findFirst({
    where: and(eq(teams.userId, userId), eq(teams.name, teamName)),
  });
  if (!team) return { error: `Team "${teamName}" not found.` };

  const members = await db
    .select({
      slot: teamMembers.slot,
      cardCode: cards.code,
      characterName: characters.name,
      series: characters.series,
      cardLevel: cards.cardLevel,
      quality: cards.quality,
      atk: cards.statAtk,
      def: cards.statDef,
      spd: cards.statSpd,
      hp: cards.statHp,
      luk: cards.statLuk,
      gearName: sql<string | null>`(SELECT name FROM gear WHERE id = ${teamMembers.gearId})`,
    })
    .from(teamMembers)
    .innerJoin(cards, eq(teamMembers.cardId, cards.id))
    .innerJoin(characters, eq(cards.characterId, characters.id))
    .where(eq(teamMembers.teamId, team.id))
    .orderBy(asc(teamMembers.slot));

  const [{ mc }] = await db.select({ mc: count() }).from(teamMembers).where(eq(teamMembers.teamId, team.id));

  return {
    team: {
      id: team.id,
      name: team.name,
      level: team.level,
      slotsUnlocked: team.slotsUnlocked,
      status: team.status,
      memberCount: mc,
    },
    members,
  };
}

export async function createTeam(
  discordId: string,
  name: string
): Promise<{ success: true; teamId: number } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { level: true },
  });
  const maxTeams = (user?.level ?? 1) >= 10 ? MAX_TEAMS_LV10 : MAX_TEAMS_BASE;

  const [{ total }] = await db.select({ total: count() }).from(teams).where(eq(teams.userId, userId));
  if (total >= maxTeams) {
    return { success: false, reason: `You have **${total}/${maxTeams}** teams.${maxTeams < MAX_TEAMS_LV10 ? " Reach Level 10 for a second team." : ""}` };
  }

  if (name.length > 24) return { success: false, reason: "Team name too long (max 24 chars)." };

  const dup = await db.query.teams.findFirst({
    where: and(eq(teams.userId, userId), eq(teams.name, name)),
  });
  if (dup) return { success: false, reason: `Team "${name}" already exists.` };

  const [team] = await db.insert(teams).values({ userId, name }).returning({ id: teams.id });
  return { success: true, teamId: team.id };
}

export async function deleteTeam(
  discordId: string,
  name: string
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");

  const team = await db.query.teams.findFirst({
    where: and(eq(teams.userId, userId), eq(teams.name, name)),
  });
  if (!team) return { success: false, reason: `Team "${name}" not found.` };
  if (team.status === "questing") return { success: false, reason: "Can't delete a team that's on a quest." };

  await db.delete(teams).where(eq(teams.id, team.id));
  return { success: true };
}

export async function renameTeam(
  discordId: string,
  oldName: string,
  newName: string
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");
  if (newName.length > 24) return { success: false, reason: "Too long (max 24 chars)." };

  const team = await db.query.teams.findFirst({
    where: and(eq(teams.userId, userId), eq(teams.name, oldName)),
  });
  if (!team) return { success: false, reason: `Team "${oldName}" not found.` };

  const dup = await db.query.teams.findFirst({
    where: and(eq(teams.userId, userId), eq(teams.name, newName)),
  });
  if (dup) return { success: false, reason: `Team "${newName}" already exists.` };

  await db.update(teams).set({ name: newName }).where(eq(teams.id, team.id));
  return { success: true };
}

export async function addTeamMember(
  discordId: string,
  teamName: string,
  cardCode: string,
  slot?: number
): Promise<{ success: true; slot: number } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");

  const team = await db.query.teams.findFirst({
    where: and(eq(teams.userId, userId), eq(teams.name, teamName)),
  });
  if (!team) return { success: false, reason: `Team "${teamName}" not found.` };
  if (team.status === "questing") return { success: false, reason: "Can't modify a team on a quest." };

  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, cardCode), eq(cards.ownerId, userId)),
    columns: { id: true, inFusionPile: true },
  });
  if (!card) return { success: false, reason: `You don't own card \`${cardCode}\`.` };
  if (card.inFusionPile) return { success: false, reason: "Card is in your fusion pile." };

  // Check card isn't already on a team
  const existing = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.cardId, card.id))
    .limit(1);
  if (existing.length > 0) {
    return { success: false, reason: "This card is already on a team. Remove it first." };
  }

  // Find available slot
  const members = await db
    .select({ slot: teamMembers.slot })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, team.id))
    .orderBy(asc(teamMembers.slot));

  const usedSlots = new Set(members.map(m => m.slot));

  if (slot !== undefined) {
    if (slot < 1 || slot > team.slotsUnlocked) {
      return { success: false, reason: `Slot must be 1-${team.slotsUnlocked}. Slots 3-4 require keys.` };
    }
    if (usedSlots.has(slot)) {
      return { success: false, reason: `Slot ${slot} is occupied.` };
    }
  } else {
    // Auto-assign
    slot = undefined;
    for (let i = 1; i <= team.slotsUnlocked; i++) {
      if (!usedSlots.has(i)) { slot = i; break; }
    }
    if (slot === undefined) {
      return { success: false, reason: `Team is full (${team.slotsUnlocked} slots). Unlock more with slot keys.` };
    }
  }

  await db.insert(teamMembers).values({ teamId: team.id, cardId: card.id, slot });
  return { success: true, slot };
}

export async function removeTeamMember(
  discordId: string,
  teamName: string,
  cardCode: string
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");

  const team = await db.query.teams.findFirst({
    where: and(eq(teams.userId, userId), eq(teams.name, teamName)),
  });
  if (!team) return { success: false, reason: `Team "${teamName}" not found.` };
  if (team.status === "questing") return { success: false, reason: "Can't modify a team on a quest." };

  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, cardCode), eq(cards.ownerId, userId)),
    columns: { id: true },
  });
  if (!card) return { success: false, reason: `You don't own card \`${cardCode}\`.` };

  const member = await db.query.teamMembers.findFirst({
    where: and(eq(teamMembers.teamId, team.id), eq(teamMembers.cardId, card.id)),
  });
  if (!member) return { success: false, reason: "Card is not on this team." };

  await db.delete(teamMembers).where(
    and(eq(teamMembers.teamId, team.id), eq(teamMembers.slot, member.slot))
  );
  return { success: true };
}

export async function unlockSlot(
  discordId: string,
  teamName: string,
  slotNum: number
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");

  const team = await db.query.teams.findFirst({
    where: and(eq(teams.userId, userId), eq(teams.name, teamName)),
  });
  if (!team) return { success: false, reason: `Team "${teamName}" not found.` };
  if (slotNum !== team.slotsUnlocked + 1) {
    return { success: false, reason: `Next slot to unlock is ${team.slotsUnlocked + 1}.` };
  }
  if (slotNum > ABSOLUTE_MAX_SLOTS) {
    return { success: false, reason: "Max slots reached." };
  }

  await db.update(teams).set({ slotsUnlocked: slotNum }).where(eq(teams.id, team.id));
  return { success: true };
}

export function getTeamStats(members: TeamMemberInfo[]): Record<string, number> {
  const stats: Record<string, number> = { atk: 0, def: 0, spd: 0, hp: 0, luk: 0 };
  for (const m of members) {
    stats.atk += m.atk;
    stats.def += m.def;
    stats.spd += m.spd;
    stats.hp += m.hp;
    stats.luk += m.luk;
  }
  return stats;
}
