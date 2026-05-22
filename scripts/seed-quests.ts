import "dotenv/config";
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

  const questsData = [
    {
      name: "Forest Patrol",
      description: "Scout the perimeter of the Whispering Woods for any disturbances.",
      location: "Whispering Woods",
      difficulty: "easy",
      required_level: 1,
      duration_minutes: 30,
      recommended_stats: { atk: 5, def: 5 },
      favored_stat: null,
      reward_gold: 50,
      reward_shards: 5,
      reward_cinders: 10,
    },
    {
      name: "Herb Gathering",
      description: "Collect rare medicinal herbs from the Moonlit Meadow.",
      location: "Moonlit Meadow",
      difficulty: "easy",
      required_level: 1,
      duration_minutes: 20,
      recommended_stats: { spd: 8, luk: 3 },
      favored_stat: "spd",
      reward_gold: 40,
      reward_shards: 3,
      reward_cinders: 5,
    },
    {
      name: "Bandit Camp Raid",
      description: "Clear out a camp of bandits threatening the nearby village.",
      location: "Dusty Plains",
      difficulty: "medium",
      required_level: 3,
      duration_minutes: 60,
      recommended_stats: { atk: 15, def: 10, hp: 8 },
      favored_stat: "atk",
      reward_gold: 120,
      reward_shards: 15,
      reward_cinders: 25,
    },
    {
      name: "Crystal Cave Expedition",
      description: "Navigate the treacherous Crystal Caves to mine rare shards.",
      location: "Crystal Caves",
      difficulty: "medium",
      required_level: 5,
      duration_minutes: 90,
      recommended_stats: { def: 15, hp: 12, luk: 8 },
      favored_stat: "def",
      reward_gold: 150,
      reward_shards: 30,
      reward_cinders: 20,
    },
    {
      name: "Dragon's Watch",
      description: "Stand guard at the ancient watchtower and repel any dragon scouts.",
      location: "Skyreach Tower",
      difficulty: "hard",
      required_level: 8,
      duration_minutes: 120,
      recommended_stats: { atk: 25, def: 20, hp: 15, spd: 10 },
      favored_stat: "atk",
      reward_gold: 300,
      reward_shards: 50,
      reward_cinders: 40,
    },
    {
      name: "Sunken Temple",
      description: "Explore the ruins of a temple beneath the Coral Sea.",
      location: "Coral Sea",
      difficulty: "hard",
      required_level: 10,
      duration_minutes: 180,
      recommended_stats: { def: 30, hp: 25, spd: 15, luk: 10 },
      favored_stat: "hp",
      reward_gold: 500,
      reward_shards: 80,
      reward_cinders: 60,
    },
    {
      name: "Shadow Gate",
      description: "Close the rift leaking dark energy into the mortal realm.",
      location: "The Void",
      difficulty: "hard",
      required_level: 15,
      duration_minutes: 240,
      recommended_stats: { atk: 40, def: 35, hp: 30, spd: 20, luk: 15 },
      favored_stat: "luk",
      reward_gold: 800,
      reward_shards: 120,
      reward_cinders: 100,
    },
  ];

  for (const q of questsData) {
    await sql`
      INSERT INTO quests (name, description, location, difficulty, required_level, duration_minutes, recommended_stats, favored_stat, reward_gold, reward_shards, reward_cinders)
      VALUES (${q.name}, ${q.description}, ${q.location}, ${q.difficulty}, ${q.required_level}, ${q.duration_minutes}, ${JSON.stringify(q.recommended_stats)}, ${q.favored_stat}, ${q.reward_gold}, ${q.reward_shards}, ${q.reward_cinders})
      ON CONFLICT DO NOTHING
    `;
    console.log(`  Seeded: ${q.name}`);
  }

  console.log(`Done. ${questsData.length} quests seeded.`);
  await sql.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
