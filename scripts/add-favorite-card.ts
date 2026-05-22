import "dotenv/config";
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_card_id integer`;
  console.log("Added favorite_card_id column to users table.");
  await sql.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
