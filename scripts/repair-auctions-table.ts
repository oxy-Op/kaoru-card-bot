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
        CREATE TABLE IF NOT EXISTS auctions (
          id serial PRIMARY KEY,
          seller_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          card_id integer NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          starting_bid bigint NOT NULL,
          current_bid bigint,
          current_bidder_id integer REFERENCES users(id),
          status text NOT NULL DEFAULT 'active',
          ends_at timestamp NOT NULL,
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now()
        )
      `);

      await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status)`);
      await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_auctions_seller ON auctions(seller_id)`);
      await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_auctions_card ON auctions(card_id)`);
      await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_auctions_ends ON auctions(ends_at)`);
    });

    console.log("[repair:auctions] Auctions table verified/created.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[repair:auctions] Failed:", err);
  process.exit(1);
});
