import "dotenv/config";
import postgres from "postgres";

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`
        ALTER TABLE cards
          ADD COLUMN IF NOT EXISTS card_level integer NOT NULL DEFAULT 1,
          ADD COLUMN IF NOT EXISTS card_xp integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS stat_atk integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS stat_def integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS stat_spd integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS stat_hp integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS stat_luk integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS unspent_points integer NOT NULL DEFAULT 0
      `);
    });

    console.log("[repair:cards-rpg] Cards RPG columns verified/added.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[repair:cards-rpg] Failed:", err);
  process.exit(1);
});
