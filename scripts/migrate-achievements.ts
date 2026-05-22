import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

async function main() {
  console.log("[Achievements] Creating tables...");

  await sql`
    CREATE TABLE IF NOT EXISTS achievements (
      id serial PRIMARY KEY,
      code text UNIQUE NOT NULL,
      name text NOT NULL,
      description text NOT NULL,
      category text NOT NULL,
      requirement_type text NOT NULL,
      requirement_value integer NOT NULL,
      reward_type text,
      reward_amount integer DEFAULT 0,
      badge_emoji text
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS user_achievements (
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      achievement_id integer NOT NULL REFERENCES achievements(id),
      progress integer NOT NULL DEFAULT 0,
      completed boolean NOT NULL DEFAULT false,
      claimed boolean NOT NULL DEFAULT false,
      completed_at timestamp,
      PRIMARY KEY (user_id, achievement_id)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id)`;

  console.log("[Achievements] Tables created. Seeding achievements...");

  // Seed achievements (upsert to be idempotent)
  const achievementData = [
    // Grab achievements
    { code: "grab_1",       name: "First Catch",        description: "Grab your first card",             category: "grab",       requirement_type: "total_grabs",   requirement_value: 1,    reward_type: "gold",    reward_amount: 50,   badge_emoji: null },
    { code: "grab_50",      name: "Card Collector",      description: "Grab 50 cards",                    category: "grab",       requirement_type: "total_grabs",   requirement_value: 50,   reward_type: "gold",    reward_amount: 200,  badge_emoji: null },
    { code: "grab_100",     name: "Keen Eye",            description: "Grab 100 cards",                   category: "grab",       requirement_type: "total_grabs",   requirement_value: 100,  reward_type: "gold",    reward_amount: 500,  badge_emoji: null },
    { code: "grab_500",     name: "Snatch Master",       description: "Grab 500 cards",                   category: "grab",       requirement_type: "total_grabs",   requirement_value: 500,  reward_type: "roses",   reward_amount: 4,    badge_emoji: null },
    { code: "grab_1000",    name: "Legendary Grabber",   description: "Grab 1000 cards",                  category: "grab",       requirement_type: "total_grabs",   requirement_value: 1000, reward_type: "roses",   reward_amount: 8,    badge_emoji: "\u{1F3C6}" },

    // Summon achievements
    { code: "summon_1",     name: "First Summon",        description: "Summon for the first time",        category: "summon",     requirement_type: "total_summons",  requirement_value: 1,    reward_type: "gold",    reward_amount: 50,   badge_emoji: null },
    { code: "summon_50",    name: "Summoner",            description: "Perform 50 summons",               category: "summon",     requirement_type: "total_summons",  requirement_value: 50,   reward_type: "gold",    reward_amount: 200,  badge_emoji: null },
    { code: "summon_100",   name: "Mystic Summoner",     description: "Perform 100 summons",              category: "summon",     requirement_type: "total_summons",  requirement_value: 100,  reward_type: "gold",    reward_amount: 500,  badge_emoji: null },
    { code: "summon_500",   name: "Arcane Summoner",     description: "Perform 500 summons",              category: "summon",     requirement_type: "total_summons",  requirement_value: 500,  reward_type: "roses",   reward_amount: 5,    badge_emoji: null },
    { code: "summon_1000",  name: "Grand Summoner",      description: "Perform 1000 summons",             category: "summon",     requirement_type: "total_summons",  requirement_value: 1000, reward_type: "roses",   reward_amount: 12,   badge_emoji: "\u2728" },

    // Fusion achievements
    { code: "fuse_1",       name: "First Fusion",        description: "Fuse cards for the first time",    category: "fusion",     requirement_type: "total_fusions",  requirement_value: 1,    reward_type: "gold",    reward_amount: 100,  badge_emoji: null },
    { code: "fuse_25",      name: "Alchemist",           description: "Perform 25 fusions",               category: "fusion",     requirement_type: "total_fusions",  requirement_value: 25,   reward_type: "gold",    reward_amount: 300,  badge_emoji: null },
    { code: "fuse_50",      name: "Master Alchemist",    description: "Perform 50 fusions",               category: "fusion",     requirement_type: "total_fusions",  requirement_value: 50,   reward_type: "roses",   reward_amount: 6,    badge_emoji: "\u{1F525}" },

    // Trade achievements
    { code: "trade_1",      name: "First Trade",         description: "Complete your first trade",         category: "trade",      requirement_type: "total_trades",   requirement_value: 1,    reward_type: "gold",    reward_amount: 100,  badge_emoji: null },
    { code: "trade_25",     name: "Dealer",              description: "Complete 25 trades",                category: "trade",      requirement_type: "total_trades",   requirement_value: 25,   reward_type: "gold",    reward_amount: 300,  badge_emoji: null },
    { code: "trade_50",     name: "Master Trader",       description: "Complete 50 trades",                category: "trade",      requirement_type: "total_trades",   requirement_value: 50,   reward_type: "roses",   reward_amount: 6,    badge_emoji: "\u{1F91D}" },

    // Gift achievements
    { code: "give_1",       name: "Generous Soul",       description: "Give your first card",              category: "social",     requirement_type: "total_gifts",    requirement_value: 1,    reward_type: "gold",    reward_amount: 75,   badge_emoji: null },
    { code: "give_50",      name: "Philanthropist",      description: "Give away 50 cards",                category: "social",     requirement_type: "total_gifts",    requirement_value: 50,   reward_type: "roses",   reward_amount: 4,    badge_emoji: "\u{1F381}" },

    // Collection achievements
    { code: "collect_10",   name: "Getting Started",     description: "Own 10 cards in your collection",   category: "collection", requirement_type: "collection_size", requirement_value: 10,   reward_type: "gold",    reward_amount: 100,  badge_emoji: null },
    { code: "collect_100",  name: "Curator",             description: "Own 100 cards in your collection",  category: "collection", requirement_type: "collection_size", requirement_value: 100,  reward_type: "gold",    reward_amount: 500,  badge_emoji: null },
    { code: "collect_500",  name: "Museum Director",     description: "Own 500 cards in your collection",  category: "collection", requirement_type: "collection_size", requirement_value: 500,  reward_type: "roses",   reward_amount: 10,   badge_emoji: "\u{1F3DB}\uFE0F" },

    // Social / profile achievements
    { code: "set_blurb",    name: "Self Expression",     description: "Set a profile blurb",               category: "social",     requirement_type: "has_blurb",      requirement_value: 1,    reward_type: "gold",    reward_amount: 50,   badge_emoji: null },
    { code: "add_wishlist", name: "Wishful Thinking",    description: "Add a character to your wishlist",  category: "social",     requirement_type: "has_wishlist",   requirement_value: 1,    reward_type: "gold",    reward_amount: 50,   badge_emoji: null },

    // Level achievements
    { code: "level_5",      name: "Rising Star",         description: "Reach level 5",                     category: "social",     requirement_type: "level",          requirement_value: 5,    reward_type: "gold",    reward_amount: 250,  badge_emoji: null },
    { code: "level_10",     name: "Veteran",             description: "Reach level 10",                    category: "social",     requirement_type: "level",          requirement_value: 10,   reward_type: "roses",   reward_amount: 10,   badge_emoji: "\u2B50" },
  ];

  for (const a of achievementData) {
    await sql`
      INSERT INTO achievements (code, name, description, category, requirement_type, requirement_value, reward_type, reward_amount, badge_emoji)
      VALUES (${a.code}, ${a.name}, ${a.description}, ${a.category}, ${a.requirement_type}, ${a.requirement_value}, ${a.reward_type}, ${a.reward_amount}, ${a.badge_emoji})
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        requirement_type = EXCLUDED.requirement_type,
        requirement_value = EXCLUDED.requirement_value,
        reward_type = EXCLUDED.reward_type,
        reward_amount = EXCLUDED.reward_amount,
        badge_emoji = EXCLUDED.badge_emoji
    `;
  }

  console.log(`[Achievements] Seeded ${achievementData.length} achievements.`);
  await sql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("[Achievements] Migration failed:", err);
  process.exit(1);
});
