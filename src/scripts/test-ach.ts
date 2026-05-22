import "dotenv/config";
import { getAchievements } from "../src/services/achievement.service.js";

async function main() {
  try {
    console.log("Testing getAchievements...");
    const result = await getAchievements("1485930652061663343");
    console.log("Got", result.length, "achievements");
    result.slice(0, 3).forEach((a) => {
      console.log(
        `  ${a.achievement.name}: ${a.progress}/${a.achievement.requirementValue} completed=${a.completed}`,
      );
    });
  } catch (err) {
    console.error("ERROR:", err);
  }
  process.exit(0);
}
main();
