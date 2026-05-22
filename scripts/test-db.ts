import "dotenv/config";
import { db } from "../src/db/index.js";
import { users, guilds } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

async function test() {
  try {
    console.log("1. Testing db.select from guilds...");
    const g = await db.select().from(guilds).limit(1);
    console.log("   OK:", g[0]?.prefix);

    console.log("2. Testing db.select from users...");
    const u = await db.select({ id: users.id, username: users.username }).from(users).limit(1);
    console.log("   OK:", u[0]?.username);

    console.log("3. Testing db.query.users.findFirst...");
    const u2 = await db.query.users.findFirst({ columns: { id: true, username: true } });
    console.log("   OK:", u2?.username);

    console.log("4. Testing ensureUser...");
    const { ensureUser } = await import("../src/services/summon.service.js");
    const uid = await ensureUser("1485930652061663343", "testtixy");
    console.log("   OK: userId =", uid);

    console.log("5. Testing profile select...");
    const [profile] = await db.select({
      id: users.id, username: users.username, gold: users.gold,
      shards: users.shards, cinders: users.cinders,
      totalSummons: users.totalSummons, totalGrabs: users.totalGrabs,
      blurb: users.blurb, joinedAt: users.joinedAt,
    }).from(users).where(eq(users.id, uid)).limit(1);
    console.log("   OK:", profile?.username, "gold:", profile?.gold);
  } catch (err: any) {
    console.error("FAILED:", err.message);
    if (err.errors) console.error("Sub-errors:", err.errors);
  }
  process.exit(0);
}
test();
