/**
 * Keep `admin_users` aligned with Discord guild roles (batch script + live bot events).
 * Optional env: ADMIN_SYNC_GUILD_ID, ADMIN_SYNC_ROLE_{OWNER,ADMIN,CURATOR,VIEWER}.
 */
import { and, eq, ne, notInArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { adminUsers } from "../db/schema.js";

const DISCORD_API = "https://discord.com/api/v10";

export type AdminPanelRole = "owner" | "admin" | "curator" | "viewer";

const RANK: Record<AdminPanelRole, number> = {
  viewer: 1,
  curator: 2,
  admin: 3,
  owner: 4,
};

function envRole(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v && /^\d+$/.test(v) ? v : undefined;
}

/** Guild id to watch, or undefined if not configured. */
export function getAdminSyncGuildId(): string | undefined {
  return (
    process.env.ADMIN_SYNC_GUILD_ID?.trim() ||
    process.env.DISCORD_DEV_GUILD_ID?.trim() ||
    undefined
  );
}

export function getAdminSyncRoleMapFromEnv(): Record<
  AdminPanelRole,
  string | undefined
> {
  return {
    owner: envRole("ADMIN_SYNC_ROLE_OWNER"),
    admin: envRole("ADMIN_SYNC_ROLE_ADMIN"),
    curator: envRole("ADMIN_SYNC_ROLE_CURATOR"),
    viewer: envRole("ADMIN_SYNC_ROLE_VIEWER"),
  };
}

export function isAdminSyncConfigured(): boolean {
  return Object.values(getAdminSyncRoleMapFromEnv()).some(Boolean);
}

export function panelRoleFromMemberRoles(
  roleIds: readonly string[],
  map: Record<AdminPanelRole, string | undefined>
): AdminPanelRole | null {
  let best: AdminPanelRole | null = null;
  let bestRank = 0;

  const tryRole = (discordRoleId: string | undefined, panel: AdminPanelRole) => {
    if (!discordRoleId || !roleIds.includes(discordRoleId)) return;
    const r = RANK[panel];
    if (r > bestRank) {
      bestRank = r;
      best = panel;
    }
  };

  tryRole(map.viewer, "viewer");
  tryRole(map.curator, "curator");
  tryRole(map.admin, "admin");
  tryRole(map.owner, "owner");

  return best;
}

export async function fetchAllGuildMembers(
  botToken: string,
  guildId: string
): Promise<Array<{ id: string; username: string; roles: string[] }>> {
  const out: Array<{ id: string; username: string; roles: string[] }> = [];
  let after: string | undefined;

  for (;;) {
    const url = new URL(`${DISCORD_API}/guilds/${guildId}/members`);
    url.searchParams.set("limit", "1000");
    if (after) url.searchParams.set("after", after);

    const res = await fetch(url, {
      headers: { Authorization: `Bot ${botToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Discord GET members failed ${res.status}: ${text.slice(0, 500)}`
      );
    }

    const chunk = (await res.json()) as Array<{
      user?: { id: string; username: string };
      roles: string[];
    }>;

    if (chunk.length === 0) break;

    for (const m of chunk) {
      if (!m.user?.id) continue;
      out.push({
        id: m.user.id,
        username: m.user.username,
        roles: m.roles ?? [],
      });
    }

    after = chunk[chunk.length - 1]!.user!.id;
    if (chunk.length < 1000) break;
  }

  return out;
}

async function isDbOwner(discordId: string): Promise<boolean> {
  const row = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.discordId, discordId),
    columns: { role: true },
  });
  return row?.role === "owner";
}

/**
 * Upsert or remove one member. Removes only `added_by = discord_sync` non-owners when they have no mapped role.
 */
export async function applyDiscordMemberToAdminUsers(
  discordId: string,
  username: string,
  roleIds: readonly string[],
  map: Record<AdminPanelRole, string | undefined>
): Promise<"upserted" | "removed" | "skipped"> {
  const panel = panelRoleFromMemberRoles(roleIds, map);

  if (!panel) {
    const existing = await db.query.adminUsers.findFirst({
      where: eq(adminUsers.discordId, discordId),
    });
    if (!existing || existing.role === "owner") return "skipped";
    if (existing.addedBy !== "discord_sync") return "skipped";
    await db.delete(adminUsers).where(eq(adminUsers.discordId, discordId));
    return "removed";
  }

  const ownerInDb = await isDbOwner(discordId);
  const roleToWrite: AdminPanelRole =
    ownerInDb && panel !== "owner" ? "owner" : panel;

  await db
    .insert(adminUsers)
    .values({
      discordId,
      username,
      role: roleToWrite,
      addedBy: "discord_sync",
    })
    .onConflictDoUpdate({
      target: adminUsers.discordId,
      set: {
        username,
        role: roleToWrite,
        updatedAt: new Date(),
      },
    });

  return "upserted";
}

export interface FullSyncResult {
  membersFetched: number;
  upserted: number;
  skippedNoRole: number;
  preservedOwner: number;
  pruned: number;
}

/**
 * Full guild scan (for `npm run sync:admin-discord`). Set ADMIN_SYNC_PRUNE=1 to delete
 * `discord_sync` rows not in the synced set (non-owners only).
 */
export async function runFullAdminSyncFromDiscord(
  botToken: string
): Promise<FullSyncResult> {
  const guildId = getAdminSyncGuildId();
  if (!guildId) {
    throw new Error(
      "Set ADMIN_SYNC_GUILD_ID or DISCORD_DEV_GUILD_ID to the guild to scan."
    );
  }

  const map = getAdminSyncRoleMapFromEnv();
  if (!Object.values(map).some(Boolean)) {
    throw new Error(
      "Set at least one ADMIN_SYNC_ROLE_OWNER|ADMIN|CURATOR|VIEWER."
    );
  }

  const members = await fetchAllGuildMembers(botToken, guildId);
  const existingOwners = new Set(
    (
      await db
        .select({ discordId: adminUsers.discordId })
        .from(adminUsers)
        .where(eq(adminUsers.role, "owner"))
    ).map((r) => r.discordId)
  );

  let upserted = 0;
  let skippedNoRole = 0;
  let preservedOwner = 0;
  const syncedIds = new Set<string>();

  for (const m of members) {
    const panel = panelRoleFromMemberRoles(m.roles, map);
    if (!panel) {
      skippedNoRole++;
      continue;
    }

    const isOwnerRow = existingOwners.has(m.id);
    const roleToWrite: AdminPanelRole =
      isOwnerRow && panel !== "owner" ? "owner" : panel;

    if (isOwnerRow && panel !== "owner") preservedOwner++;

    await db
      .insert(adminUsers)
      .values({
        discordId: m.id,
        username: m.username,
        role: roleToWrite,
        addedBy: "discord_sync",
      })
      .onConflictDoUpdate({
        target: adminUsers.discordId,
        set: {
          username: m.username,
          role: roleToWrite,
          updatedAt: new Date(),
        },
      });

    syncedIds.add(m.id);
    upserted++;
  }

  let pruned = 0;
  const prune =
    process.env.ADMIN_SYNC_PRUNE?.trim() === "1" ||
    process.env.ADMIN_SYNC_PRUNE?.trim().toLowerCase() === "true";

  if (prune && syncedIds.size > 0) {
    const removed = await db
      .delete(adminUsers)
      .where(
        and(
          ne(adminUsers.role, "owner"),
          eq(adminUsers.addedBy, "discord_sync"),
          notInArray(adminUsers.discordId, [...syncedIds])
        )
      )
      .returning({ id: adminUsers.id });
    pruned = removed.length;
  }

  return {
    membersFetched: members.length,
    upserted,
    skippedNoRole,
    preservedOwner,
    pruned,
  };
}
