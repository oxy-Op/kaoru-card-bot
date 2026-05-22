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
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS favorite_card_id integer,
          ADD COLUMN IF NOT EXISTS max_albums integer NOT NULL DEFAULT 2,
          ADD COLUMN IF NOT EXISTS max_album_pages integer NOT NULL DEFAULT 5,
          ADD COLUMN IF NOT EXISTS wish_character_id integer,
          ADD COLUMN IF NOT EXISTS wish_summons_remaining integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS low_print_pity_streak integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS roses bigint NOT NULL DEFAULT 0
      `);
    });

    console.log("[repair:users] Users columns verified/added.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[repair:users] Failed:", err);
  process.exit(1);
});
