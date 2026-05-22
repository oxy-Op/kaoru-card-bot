/**
 * Upsert admin_users from Discord guild roles (batch).
 *
 * Prefer live sync via the bot (GuildMemberUpdate) when running with ADMIN_SYNC_* set.
 *
 * Env: DISCORD_TOKEN, DATABASE_URL, ADMIN_SYNC_GUILD_ID or DISCORD_DEV_GUILD_ID,
 *      at least one ADMIN_SYNC_ROLE_*.
 * Optional: ADMIN_SYNC_PRUNE=1 — remove discord_sync rows not in this sync (non-owners).
 *
 * Bot needs Server Members Intent for batch fetch and for live member events.
 */
import "dotenv/config";
import { runFullAdminSyncFromDiscord } from "../src/services/admin-panel-sync.service.js";

async function main() {
  const token = process.env.DISCORD_TOKEN?.trim();
  if (!token) {
    console.error("DISCORD_TOKEN is required.");
    process.exit(1);
  }

  console.log("Running full admin sync from Discord…");
  const r = await runFullAdminSyncFromDiscord(token);

  console.log(`  Fetched ${r.membersFetched} guild members.`);
  console.log(
    `  Upserted/updated ${r.upserted} admin_users with a mapped role.`,
  );
  console.log(
    `  Skipped ${r.skippedNoRole} members with no mapped panel role.`,
  );
  if (r.preservedOwner > 0) {
    console.log(
      `  Preserved DB owner for ${r.preservedOwner} user(s) without owner Discord role.`,
    );
  }
  if (r.pruned > 0) {
    console.log(
      `  Pruned ${r.pruned} discord_sync admin row(s) no longer in sync set.`,
    );
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
