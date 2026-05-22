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
        CREATE TABLE IF NOT EXISTS petal_transactions (
          id serial PRIMARY KEY,
          user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          amount bigint NOT NULL,
          balance_after bigint NOT NULL,
          direction text NOT NULL,
          reason text NOT NULL,
          source text NOT NULL DEFAULT 'internal',
          idempotency_key text NOT NULL UNIQUE,
          external_ref text,
          metadata jsonb DEFAULT '{}'::jsonb,
          created_at timestamp NOT NULL DEFAULT now()
        )
      `);

      await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_petal_transactions_user ON petal_transactions(user_id)`);
      await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_petal_transactions_created ON petal_transactions(created_at)`);
      await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_petal_transactions_reason ON petal_transactions(reason)`);
    });

    console.log("[repair:petals] Petal transactions table verified/created.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[repair:petals] Failed:", err);
  process.exit(1);
});
