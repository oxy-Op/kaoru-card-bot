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
    const rows = await sql<{
      character_id: number;
      image_url: string | null;
      source_url: string | null;
    }[]>`
      SELECT
        c.id AS character_id,
        c.image_url,
        c.image_url AS source_url
      FROM character_editions e
      JOIN characters c ON c.id = e.character_id
      WHERE e.edition_number = 1
        AND e.summonable = true
        AND e.max_prints IS NOT NULL
        AND e.current_prints >= e.max_prints
        AND NOT EXISTS (
          SELECT 1
          FROM pending_editions pe
          WHERE pe.character_id = c.id
            AND pe.status = 'pending'
        )
    `;

    if (rows.length === 0) {
      console.log("[curation:queue-depleted] No depleted characters to queue.");
      return;
    }

    for (const row of rows) {
      await sql`
        INSERT INTO pending_editions (
          character_id,
          image_url,
          source,
          source_url,
          status,
          created_at
        )
        VALUES (
          ${row.character_id},
          ${row.image_url ?? ""},
          'custom',
          ${row.source_url},
          'pending',
          now()
        )
      `;
    }

    console.log(`[curation:queue-depleted] Queued ${rows.length} depleted characters.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[curation:queue-depleted] Failed:", err);
  process.exit(1);
});
