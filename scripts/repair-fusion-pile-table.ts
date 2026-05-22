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
        CREATE TABLE IF NOT EXISTS fusion_pile_entries (
          id serial PRIMARY KEY,
          character_id integer NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          edition_id integer NOT NULL REFERENCES character_editions(id) ON DELETE CASCADE,
          source_card_id integer REFERENCES cards(id) ON DELETE SET NULL,
          source_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          source text NOT NULL DEFAULT 'fusion',
          status text NOT NULL DEFAULT 'available',
          claimed_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          claimed_card_id integer REFERENCES cards(id) ON DELETE SET NULL,
          claim_summon_id text,
          created_at timestamp NOT NULL DEFAULT now(),
          claimed_at timestamp
        )
      `);

      await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_fusion_pile_status ON fusion_pile_entries(status)`);
      await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_fusion_pile_created ON fusion_pile_entries(created_at)`);
      await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_fusion_pile_claimed_user ON fusion_pile_entries(claimed_by_user_id)`);
      await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_fusion_pile_character ON fusion_pile_entries(character_id)`);
    });

    console.log("[repair:fusion-pile] Fusion pile table verified/created.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[repair:fusion-pile] Failed:", err);
  process.exit(1);
});
