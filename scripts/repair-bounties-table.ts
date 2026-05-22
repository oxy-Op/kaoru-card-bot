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
        CREATE TABLE IF NOT EXISTS bounties (
          id serial PRIMARY KEY,
          requester_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          character_id integer NOT NULL REFERENCES characters(id),
          gold_amount bigint NOT NULL,
          status text NOT NULL DEFAULT 'active',
          fulfilled_by_user_id integer REFERENCES users(id),
          fulfilled_card_id integer REFERENCES cards(id),
          expires_at timestamp NOT NULL,
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now()
        )
      `);

      await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status)`);
      await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_bounties_requester ON bounties(requester_id)`);
      await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_bounties_character ON bounties(character_id)`);
      await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_bounties_expires ON bounties(expires_at)`);
    });

    console.log("[repair:bounties] Bounties table verified/created.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[repair:bounties] Failed:", err);
  process.exit(1);
});
