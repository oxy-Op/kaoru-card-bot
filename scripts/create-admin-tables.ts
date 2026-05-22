import "dotenv/config";
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

  await sql`
    CREATE TABLE IF NOT EXISTS admin_users (
      id serial PRIMARY KEY,
      discord_id text NOT NULL UNIQUE,
      username text NOT NULL,
      role text NOT NULL DEFAULT 'viewer',
      added_by text,
      created_at timestamp DEFAULT now() NOT NULL,
      updated_at timestamp DEFAULT now() NOT NULL
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS pending_editions (
      id serial PRIMARY KEY,
      character_id integer NOT NULL REFERENCES characters(id),
      image_url text NOT NULL,
      image_path text,
      source text NOT NULL,
      source_url text,
      artist_name text,
      artist_url text,
      status text NOT NULL DEFAULT 'pending',
      reviewed_by integer REFERENCES users(id),
      reviewed_at timestamp,
      rejection_reason text,
      created_at timestamp DEFAULT now() NOT NULL
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_editions (status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pending_character ON pending_editions (character_id)`;

  // Add new columns to character_editions if they don't exist
  await sql`ALTER TABLE character_editions ADD COLUMN IF NOT EXISTS summonable boolean NOT NULL DEFAULT true`;
  await sql`ALTER TABLE character_editions ADD COLUMN IF NOT EXISTS artist_name text`;
  await sql`ALTER TABLE character_editions ADD COLUMN IF NOT EXISTS artist_url text`;
  await sql`ALTER TABLE character_editions ADD COLUMN IF NOT EXISTS source_url text`;

  console.log("admin_users + pending_editions tables created, character_editions columns added.");
  await sql.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
