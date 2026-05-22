import "dotenv/config";
import { db } from "../src/db/index.js";
import { characters, characterEditions } from "../src/db/schema.js";
import { eq, sql, and } from "drizzle-orm";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { generateEdition, pickRandomEditions, type EditionType } from "../src/image/editions/index.js";

const IMAGE_DIR = process.env.IMAGE_DIR ?? "./data/images";
const EDITIONS_PER_CHAR = parseInt(process.argv[2] ?? "3", 10);
const BATCH_SIZE = parseInt(process.argv[3] ?? "10", 10);
const START_ID = parseInt(process.argv[4] ?? "0", 10);

function computeRarityWeight(popularity: number, role?: string | null): number {
  const popNorm = Math.max(0, Math.log10(popularity + 1));
  const roleAdj = role === "MAIN" ? 1.15 : role === "SUPPORTING" ? 1.0 : 0.9;
  return Math.max(0.15, Math.min(2.0, 0.55 + popNorm * 0.22)) * roleAdj;
}

async function main() {
  console.log(`[Editions] Generating ${EDITIONS_PER_CHAR} editions per character (batch ${BATCH_SIZE}, start ID ${START_ID})`);

  // Get characters that only have edition 1 (original)
  const chars = await db
    .select({
      id: characters.id,
      name: characters.name,
      popularity: characters.popularity,
      role: characters.role,
    })
    .from(characters)
    .where(sql`${characters.id} > ${START_ID}`)
    .orderBy(characters.id)
    .limit(1000);

  let totalGenerated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (let i = 0; i < chars.length; i += BATCH_SIZE) {
    const batch = chars.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (char) => {
      try {
        // Check how many editions already exist
        const existing = await db
          .select({ editionNumber: characterEditions.editionNumber })
          .from(characterEditions)
          .where(eq(characterEditions.characterId, char.id));

        const existingNums = new Set(existing.map((e) => e.editionNumber));

        if (existingNums.size >= EDITIONS_PER_CHAR + 1) {
          totalSkipped++;
          return;
        }

        // Load original image
        const origPath = join(IMAGE_DIR, `characters/${char.id}/ed1.png`);
        let src: Buffer;
        try {
          src = await readFile(origPath);
        } catch {
          totalSkipped++;
          return; // No original image
        }

        // Pick edition types
        const editionsNeeded = EDITIONS_PER_CHAR + 1 - existingNums.size;
        const types = pickRandomEditions(editionsNeeded);

        let edNum = Math.max(...existingNums) + 1;

        for (const type of types) {
          try {
            const edBuffer = await generateEdition(src, type);

            const relPath = `characters/${char.id}/ed${edNum}.png`;
            const fullPath = join(IMAGE_DIR, relPath);
            await mkdir(dirname(fullPath), { recursive: true });
            await writeFile(fullPath, edBuffer);

            // Rarer editions for more popular chars (lower weight on generated editions)
            const baseWeight = computeRarityWeight(char.popularity ?? 0, char.role);
            const editionWeight = baseWeight * 0.8; // Generated editions slightly rarer

            await db.insert(characterEditions).values({
              characterId: char.id,
              editionNumber: edNum,
              imagePath: relPath,
              generationMethod: type as any,
              rarityWeight: editionWeight,
            });

            totalGenerated++;
            edNum++;
          } catch (err) {
            totalFailed++;
          }
        }
      } catch {
        totalFailed++;
      }
    }));

    if ((i / BATCH_SIZE) % 10 === 0) {
      console.log(`[Editions] Progress: ${i}/${chars.length} chars, +${totalGenerated} editions, ${totalSkipped} skipped, ${totalFailed} failed`);
    }
  }

  console.log(`[Editions] Done! Generated: ${totalGenerated}, Skipped: ${totalSkipped}, Failed: ${totalFailed}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[Editions] Fatal:", err);
  process.exit(1);
});
