import type { GuildMember } from "discord.js";
import {
  applyDiscordMemberToAdminUsers,
  getAdminSyncGuildId,
  getAdminSyncRoleMapFromEnv,
  isAdminSyncConfigured,
} from "../services/admin-panel-sync.service.js";

export async function handleAdminPanelMemberChange(member: GuildMember): Promise<void> {
  const guildId = getAdminSyncGuildId();
  if (!guildId || member.guild.id !== guildId) return;
  if (!isAdminSyncConfigured()) return;

  const map = getAdminSyncRoleMapFromEnv();
  const roleIds = [...member.roles.cache.keys()];

  await applyDiscordMemberToAdminUsers(
    member.id,
    member.user.username,
    roleIds,
    map
  );
}
