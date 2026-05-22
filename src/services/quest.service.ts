import { db } from "../db/index.js";
import { quests, userQuests, teams, users, cards, teamMembers, characters } from "../db/schema.js";
import { eq, and, sql, asc, desc, count, ne } from "drizzle-orm";
import { ensureUser } from "./summon.service.js";
import { getTeamDetails, getTeamStats } from "./team.service.js";

export interface QuestInfo {
  id: number;
  name: string;
  description: string;
  location: string;
  difficulty: string;
  requiredLevel: number;
  durationMinutes: number;
  recommendedStats: Record<string, number>;
  favoredStat: string | null;
  rewardGold: number;
  rewardShards: number;
  rewardCinders: number;
}

export async function getQuestList(discordId: string): Promise<QuestInfo[]> {
  const userId = await ensureUser(discordId, "");
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { level: true },
  });
  const level = user?.level ?? 1;

  const rows = await db
    .select()
    .from(quests)
    .orderBy(asc(quests.requiredLevel), asc(quests.id));

  return rows.map(q => ({
    id: q.id,
    name: q.name,
    description: q.description,
    location: q.location,
    difficulty: q.difficulty,
    requiredLevel: q.requiredLevel,
    durationMinutes: q.durationMinutes,
    recommendedStats: (q.recommendedStats ?? {}) as Record<string, number>,
    favoredStat: q.favoredStat,
    rewardGold: q.rewardGold,
    rewardShards: q.rewardShards,
    rewardCinders: q.rewardCinders,
  }));
}

export async function getQuestInfo(questId: number): Promise<QuestInfo | null> {
  const q = await db.query.quests.findFirst({ where: eq(quests.id, questId) });
  if (!q) return null;
  return {
    id: q.id,
    name: q.name,
    description: q.description,
    location: q.location,
    difficulty: q.difficulty,
    requiredLevel: q.requiredLevel,
    durationMinutes: q.durationMinutes,
    recommendedStats: (q.recommendedStats ?? {}) as Record<string, number>,
    favoredStat: q.favoredStat,
    rewardGold: q.rewardGold,
    rewardShards: q.rewardShards,
    rewardCinders: q.rewardCinders,
  };
}

function calculateSuccessChance(
  teamStats: Record<string, number>,
  recommendedStats: Record<string, number>,
  favoredStat: string | null
): number {
  if (Object.keys(recommendedStats).length === 0) return 0.6;

  let totalRatio = 0;
  let statCount = 0;

  for (const [stat, recommended] of Object.entries(recommendedStats)) {
    if (recommended <= 0) continue;
    const actual = teamStats[stat] ?? 0;
    let ratio = actual / recommended;
    // Favored stat is worth more
    if (favoredStat && stat === favoredStat) ratio *= 1.2;
    totalRatio += Math.min(ratio, 2.0); // cap at 2x
    statCount++;
  }

  if (statCount === 0) return 0.6;

  // 1.0 ratio = 60% success; scale linearly
  const avgRatio = totalRatio / statCount;
  const chance = Math.min(0.95, Math.max(0.05, avgRatio * 0.6));
  return Math.round(chance * 100) / 100;
}

function calculateDuration(
  baseDuration: number,
  teamStats: Record<string, number>
): number {
  const speed = teamStats.spd ?? 0;
  // Each point of speed reduces duration by 0.5%, cap at 50% reduction
  const reduction = Math.min(0.5, speed * 0.005);
  return Math.ceil(baseDuration * (1 - reduction));
}

export interface ActiveQuest {
  questId: number;
  questName: string;
  teamName: string;
  endsAt: Date;
  remainingMinutes: number;
  successChance: number;
}

export async function getActiveQuests(discordId: string): Promise<ActiveQuest[]> {
  const userId = await ensureUser(discordId, "");

  const rows = await db
    .select({
      questId: userQuests.questId,
      questName: quests.name,
      teamName: teams.name,
      endsAt: userQuests.endsAt,
      successChance: userQuests.successChance,
    })
    .from(userQuests)
    .innerJoin(quests, eq(userQuests.questId, quests.id))
    .innerJoin(teams, eq(userQuests.teamId, teams.id))
    .where(and(eq(userQuests.userId, userId), eq(userQuests.status, "active")));

  const now = new Date();
  return rows.map(r => ({
    questId: r.questId,
    questName: r.questName,
    teamName: r.teamName,
    endsAt: r.endsAt,
    remainingMinutes: Math.max(0, Math.ceil((r.endsAt.getTime() - now.getTime()) / 60000)),
    successChance: r.successChance,
  }));
}

export async function startQuest(
  discordId: string,
  questId: number,
  teamName: string
): Promise<{
  success: true;
  questName: string;
  teamName: string;
  endsAt: Date;
  durationMin: number;
  successChance: number;
} | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");

  const quest = await db.query.quests.findFirst({ where: eq(quests.id, questId) });
  if (!quest) return { success: false, reason: "Quest not found." };

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { level: true },
  });
  if ((user?.level ?? 1) < quest.requiredLevel) {
    return { success: false, reason: `Requires player level **${quest.requiredLevel}**. You're level ${user?.level ?? 1}.` };
  }

  const teamResult = await getTeamDetails(discordId, teamName);
  if ("error" in teamResult) return { success: false, reason: teamResult.error };

  if (teamResult.team.status === "questing") {
    return { success: false, reason: `**${teamName}** is already on a quest.` };
  }
  if (teamResult.members.length === 0) {
    return { success: false, reason: "Team has no members." };
  }

  // Check team isn't already on this quest with another team
  const existingOnQuest = await db
    .select({ id: userQuests.id })
    .from(userQuests)
    .where(and(
      eq(userQuests.userId, userId),
      eq(userQuests.questId, questId),
      eq(userQuests.status, "active")
    ))
    .limit(1);
  if (existingOnQuest.length > 0) {
    return { success: false, reason: "You already have a team on this quest." };
  }

  const teamStats = getTeamStats(teamResult.members);
  const recommended = (quest.recommendedStats ?? {}) as Record<string, number>;
  const successChance = calculateSuccessChance(teamStats, recommended, quest.favoredStat);
  const durationMin = calculateDuration(quest.durationMinutes, teamStats);
  const endsAt = new Date(Date.now() + durationMin * 60000);

  // Check if this is a first clear
  const previousClears = await db
    .select({ id: userQuests.id })
    .from(userQuests)
    .where(and(
      eq(userQuests.userId, userId),
      eq(userQuests.questId, questId),
      eq(userQuests.status, "completed")
    ))
    .limit(1);
  const firstClear = previousClears.length === 0;

  await db.insert(userQuests).values({
    userId,
    questId,
    teamId: teamResult.team.id,
    endsAt,
    successChance,
    firstClear,
  });

  await db.update(teams).set({ status: "questing" }).where(eq(teams.id, teamResult.team.id));

  return {
    success: true,
    questName: quest.name,
    teamName,
    endsAt,
    durationMin,
    successChance,
  };
}

export async function completeQuest(
  discordId: string,
  teamName: string
): Promise<{
  success: true;
  won: boolean;
  questName: string;
  rewards?: { gold: number; shards: number; cinders: number; xp: number; firstClearBonus: boolean };
  failureMessage?: string;
} | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");

  const team = await db.query.teams.findFirst({
    where: and(eq(teams.userId, userId), eq(teams.name, teamName)),
  });
  if (!team) return { success: false, reason: `Team "${teamName}" not found.` };
  if (team.status !== "questing") return { success: false, reason: "This team is not on a quest." };

  const activeQuest = await db
    .select({
      id: userQuests.id,
      questId: userQuests.questId,
      endsAt: userQuests.endsAt,
      successChance: userQuests.successChance,
      firstClear: userQuests.firstClear,
    })
    .from(userQuests)
    .where(and(eq(userQuests.teamId, team.id), eq(userQuests.status, "active")))
    .limit(1);

  if (activeQuest.length === 0) {
    await db.update(teams).set({ status: "home" }).where(eq(teams.id, team.id));
    return { success: false, reason: "No active quest found for this team." };
  }

  const aq = activeQuest[0];
  const now = new Date();
  if (now < aq.endsAt) {
    const mins = Math.ceil((aq.endsAt.getTime() - now.getTime()) / 60000);
    return { success: false, reason: `Quest not complete yet. **${mins}m** remaining.` };
  }

  const quest = await db.query.quests.findFirst({ where: eq(quests.id, aq.questId) });
  if (!quest) return { success: false, reason: "Quest data missing." };

  // Roll success
  const won = Math.random() < aq.successChance;

  // Set team back to home
  await db.update(teams).set({ status: "home" }).where(eq(teams.id, team.id));

  if (!won) {
    await db.update(userQuests)
      .set({ status: "failed", completedAt: now })
      .where(eq(userQuests.id, aq.id));

    const failures = [
      "The team got lost in a dense fog...",
      "A sudden storm forced the team to retreat.",
      "The enemy was too powerful this time.",
      "The team ran out of supplies midway.",
      "An ambush caught the team off guard.",
    ];

    return {
      success: true,
      won: false,
      questName: quest.name,
      failureMessage: failures[Math.floor(Math.random() * failures.length)],
    };
  }

  // Award rewards
  const multiplier = aq.firstClear ? 2 : 1;
  const gold = quest.rewardGold * multiplier;
  const shards = quest.rewardShards * multiplier;
  const cinders = quest.rewardCinders * multiplier;
  const xp = Math.floor((quest.durationMinutes / 10) * multiplier);

  await db.update(users).set({
    gold: sql`${users.gold} + ${gold}`,
    shards: sql`${users.shards} + ${shards}`,
    cinders: sql`${users.cinders} + ${cinders}`,
  }).where(eq(users.id, userId));

  // Award card XP to team members
  const members = await db
    .select({ cardId: teamMembers.cardId })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, team.id));

  for (const m of members) {
    await db.update(cards).set({
      cardXp: sql`${cards.cardXp} + ${xp}`,
    }).where(eq(cards.id, m.cardId));
  }

  await db.update(userQuests)
    .set({ status: "completed", completedAt: now })
    .where(eq(userQuests.id, aq.id));

  return {
    success: true,
    won: true,
    questName: quest.name,
    rewards: { gold, shards, cinders, xp, firstClearBonus: aq.firstClear },
  };
}

export async function cancelQuest(
  discordId: string,
  teamName: string
): Promise<{ success: true; questName: string } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");

  const team = await db.query.teams.findFirst({
    where: and(eq(teams.userId, userId), eq(teams.name, teamName)),
  });
  if (!team) return { success: false, reason: `Team "${teamName}" not found.` };
  if (team.status !== "questing") return { success: false, reason: "This team is not on a quest." };

  const aq = await db
    .select({ id: userQuests.id, questId: userQuests.questId })
    .from(userQuests)
    .where(and(eq(userQuests.teamId, team.id), eq(userQuests.status, "active")))
    .limit(1);

  if (aq.length === 0) {
    await db.update(teams).set({ status: "home" }).where(eq(teams.id, team.id));
    return { success: false, reason: "No active quest." };
  }

  const quest = await db.query.quests.findFirst({ where: eq(quests.id, aq[0].questId) });

  await db.update(userQuests)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(userQuests.id, aq[0].id));

  await db.update(teams).set({ status: "home" }).where(eq(teams.id, team.id));

  return { success: true, questName: quest?.name ?? "Unknown" };
}
