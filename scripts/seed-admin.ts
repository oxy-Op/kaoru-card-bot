import "dotenv/config";
import postgres from "postgres";

async function main() {
  const devUserIds = process.env.DEV_USER_IDS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

  if (devUserIds.length === 0) {
    console.log("No DEV_USER_IDS set in .env. Skipping admin seed.");
    process.exit(0);
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

  for (const discordId of devUserIds) {
    await sql`
      INSERT INTO admin_users (discord_id, username, role, added_by)
      VALUES (${discordId}, ${"owner"}, ${"owner"}, ${"system"})
      ON CONFLICT (discord_id) DO UPDATE SET role = 'owner', updated_at = now()
    `;
    console.log(`  Seeded admin: ${discordId} as owner`);
  }

  console.log(`Done. ${devUserIds.length} owner(s) seeded.`);
  await sql.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
