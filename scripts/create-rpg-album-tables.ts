import "dotenv/config";
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

  // Card RPG stats
  await sql`ALTER TABLE cards ADD COLUMN IF NOT EXISTS card_level integer NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE cards ADD COLUMN IF NOT EXISTS card_xp integer NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE cards ADD COLUMN IF NOT EXISTS stat_atk integer NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE cards ADD COLUMN IF NOT EXISTS stat_def integer NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE cards ADD COLUMN IF NOT EXISTS stat_spd integer NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE cards ADD COLUMN IF NOT EXISTS stat_hp integer NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE cards ADD COLUMN IF NOT EXISTS stat_luk integer NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE cards ADD COLUMN IF NOT EXISTS unspent_points integer NOT NULL DEFAULT 0`;
  console.log("Card RPG stats columns added.");

  // User album + favorite columns
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_card_id integer`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS max_albums integer NOT NULL DEFAULT 2`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS max_album_pages integer NOT NULL DEFAULT 5`;
  console.log("User album columns added.");

  // Team enhancements
  await sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS slots_unlocked integer NOT NULL DEFAULT 2`;
  await sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'home'`;
  console.log("Team columns added.");

  // Quest enhancements
  await sql`ALTER TABLE quests ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT 'Unknown'`;
  await sql`ALTER TABLE quests ADD COLUMN IF NOT EXISTS difficulty text NOT NULL DEFAULT 'easy'`;
  await sql`ALTER TABLE quests ADD COLUMN IF NOT EXISTS duration_minutes integer NOT NULL DEFAULT 60`;
  await sql`ALTER TABLE quests ADD COLUMN IF NOT EXISTS recommended_stats jsonb DEFAULT '{}'`;
  await sql`ALTER TABLE quests ADD COLUMN IF NOT EXISTS favored_stat text`;
  await sql`ALTER TABLE quests ADD COLUMN IF NOT EXISTS reward_cinders integer NOT NULL DEFAULT 0`;
  console.log("Quest columns added.");

  // Rebuild user_quests (drop old PK-based, recreate with proper structure)
  await sql`
    CREATE TABLE IF NOT EXISTS user_quests_v2 (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      quest_id integer NOT NULL REFERENCES quests(id),
      team_id integer NOT NULL REFERENCES teams(id),
      status text NOT NULL DEFAULT 'active',
      started_at timestamp DEFAULT now() NOT NULL,
      completed_at timestamp,
      ends_at timestamp NOT NULL DEFAULT now(),
      success_chance real NOT NULL DEFAULT 0.5,
      first_clear boolean NOT NULL DEFAULT false
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_user_quests_v2_user ON user_quests_v2 (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_user_quests_v2_team ON user_quests_v2 (team_id)`;
  console.log("user_quests_v2 table created.");

  // Albums
  await sql`
    CREATE TABLE IF NOT EXISTS albums (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL,
      default_background_id integer,
      created_at timestamp DEFAULT now() NOT NULL
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_albums_user ON albums (user_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS album_pages (
      id serial PRIMARY KEY,
      album_id integer NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      page_number integer NOT NULL,
      background_id integer
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_album_pages_album ON album_pages (album_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS album_cards (
      id serial PRIMARY KEY,
      page_id integer NOT NULL REFERENCES album_pages(id) ON DELETE CASCADE,
      card_id integer NOT NULL REFERENCES cards(id),
      position real NOT NULL
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_album_cards_page ON album_cards (page_id)`;
  console.log("Album tables created.");

  console.log("All RPG + Album migrations complete.");
  await sql.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
