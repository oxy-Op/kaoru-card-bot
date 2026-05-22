import "dotenv/config";
import postgres from "postgres";

const args = new Set(process.argv.slice(2));
const isDryRun = args.has("--dry-run") || !args.has("--execute");
const isExecute = args.has("--execute");

function mustDatabaseUrl(): string {
  const v = process.env.DATABASE_URL?.trim();
  if (!v) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  return v;
}

async function summary(sql: postgres.Sql) {
  const [{ doomed_editions }] = await sql<{ doomed_editions: number }[]>`
    SELECT COUNT(*)::int AS doomed_editions
    FROM character_editions
    WHERE edition_number <> 1
  `;

  const [{ doomed_cards }] = await sql<{ doomed_cards: number }[]>`
    SELECT COUNT(*)::int AS doomed_cards
    FROM cards c
    JOIN character_editions e ON e.id = c.edition_id
    WHERE e.edition_number <> 1
  `;

  const [{ doomed_event_cards }] = await sql<{ doomed_event_cards: number }[]>`
    SELECT COUNT(*)::int AS doomed_event_cards
    FROM event_cards ec
    JOIN character_editions e ON e.id = ec.edition_id
    WHERE e.edition_number <> 1
  `;

  const impactedCharacters = await sql<{
    character_id: number;
    editions_to_delete: number;
    cards_to_delete: number;
  }[]>`
    SELECT
      e.character_id,
      COUNT(e.id)::int AS editions_to_delete,
      COUNT(c.id)::int AS cards_to_delete
    FROM character_editions e
    LEFT JOIN cards c ON c.edition_id = e.id
    WHERE e.edition_number <> 1
    GROUP BY e.character_id
    ORDER BY editions_to_delete DESC, cards_to_delete DESC
    LIMIT 10
  `;

  return {
    doomedEditions: doomed_editions,
    doomedCards: doomed_cards,
    doomedEventCards: doomed_event_cards,
    impactedCharacters,
  };
}

async function execute(sql: postgres.Sql) {
  return sql.begin(async (tx) => {
    const tableExists = async (tableName: string) => {
      const [{ exists }] = await tx<{ exists: boolean }[]>`
        SELECT to_regclass(${tableName}) IS NOT NULL AS exists
      `;
      return exists;
    };

    const [{ users_fav_cleared }] = await tx<{ users_fav_cleared: number }[]>`
      WITH doomed_cards AS (
        SELECT c.id
        FROM cards c
        JOIN character_editions e ON e.id = c.edition_id
        WHERE e.edition_number <> 1
      ),
      upd AS (
        UPDATE users
        SET favorite_card_id = NULL
        WHERE favorite_card_id IN (SELECT id FROM doomed_cards)
        RETURNING 1
      )
      SELECT COUNT(*)::int AS users_fav_cleared FROM upd
    `;

    const giftsTableExists = await tableExists("gifts");
    const [{ gifts_deleted }] = giftsTableExists
      ? await tx<{ gifts_deleted: number }[]>`
          WITH doomed_cards AS (
            SELECT c.id
            FROM cards c
            JOIN character_editions e ON e.id = c.edition_id
            WHERE e.edition_number <> 1
          ),
          del AS (
            DELETE FROM gifts
            WHERE card_id IN (SELECT id FROM doomed_cards)
            RETURNING 1
          )
          SELECT COUNT(*)::int AS gifts_deleted FROM del
        `
      : [{ gifts_deleted: 0 }];

    const teamMembersTableExists = await tableExists("team_members");
    const [{ team_members_deleted }] = teamMembersTableExists
      ? await tx<{ team_members_deleted: number }[]>`
          WITH doomed_cards AS (
            SELECT c.id
            FROM cards c
            JOIN character_editions e ON e.id = c.edition_id
            WHERE e.edition_number <> 1
          ),
          del AS (
            DELETE FROM team_members
            WHERE card_id IN (SELECT id FROM doomed_cards)
            RETURNING 1
          )
          SELECT COUNT(*)::int AS team_members_deleted FROM del
        `
      : [{ team_members_deleted: 0 }];

    const albumCardsTableExists = await tableExists("album_cards");
    const [{ album_cards_deleted }] = albumCardsTableExists
      ? await tx<{ album_cards_deleted: number }[]>`
          WITH doomed_cards AS (
            SELECT c.id
            FROM cards c
            JOIN character_editions e ON e.id = c.edition_id
            WHERE e.edition_number <> 1
          ),
          del AS (
            DELETE FROM album_cards
            WHERE card_id IN (SELECT id FROM doomed_cards)
            RETURNING 1
          )
          SELECT COUNT(*)::int AS album_cards_deleted FROM del
        `
      : [{ album_cards_deleted: 0 }];

    const [{ cards_deleted }] = await tx<{ cards_deleted: number }[]>`
      WITH del AS (
        DELETE FROM cards c
        USING character_editions e
        WHERE c.edition_id = e.id
          AND e.edition_number <> 1
        RETURNING 1
      )
      SELECT COUNT(*)::int AS cards_deleted FROM del
    `;

    const eventCardsTableExists = await tableExists("event_cards");
    const [{ event_cards_deleted }] = eventCardsTableExists
      ? await tx<{ event_cards_deleted: number }[]>`
          WITH del AS (
            DELETE FROM event_cards ec
            USING character_editions e
            WHERE ec.edition_id = e.id
              AND e.edition_number <> 1
            RETURNING 1
          )
          SELECT COUNT(*)::int AS event_cards_deleted FROM del
        `
      : [{ event_cards_deleted: 0 }];

    const [{ editions_deleted }] = await tx<{ editions_deleted: number }[]>`
      WITH del AS (
        DELETE FROM character_editions
        WHERE edition_number <> 1
        RETURNING 1
      )
      SELECT COUNT(*)::int AS editions_deleted FROM del
    `;

    return {
      usersFavCleared: users_fav_cleared,
      giftsDeleted: gifts_deleted,
      teamMembersDeleted: team_members_deleted,
      albumCardsDeleted: album_cards_deleted,
      cardsDeleted: cards_deleted,
      eventCardsDeleted: event_cards_deleted,
      editionsDeleted: editions_deleted,
    };
  });
}

async function main() {
  const databaseUrl = mustDatabaseUrl();
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const s = await summary(sql);
    console.log("[editions:prune] keep rule: edition_number = 1 only");
    console.log(
      `[editions:prune] target counts -> editions: ${s.doomedEditions}, cards: ${s.doomedCards}, event_cards: ${s.doomedEventCards}`
    );
    if (s.impactedCharacters.length) {
      console.log("[editions:prune] top impacted characters (id, editions, cards):");
      for (const row of s.impactedCharacters) {
        console.log(
          `  - ${row.character_id}: editions=${row.editions_to_delete}, cards=${row.cards_to_delete}`
        );
      }
    }

    if (isDryRun || !isExecute) {
      console.log("[editions:prune] dry-run only. Use --execute to apply.");
      return;
    }

    const destructiveConfirmed =
      process.env.CONFIRM_DESTRUCTIVE?.trim().toLowerCase() === "yes";
    if (!destructiveConfirmed) {
      console.error(
        "[editions:prune] Refusing destructive run without CONFIRM_DESTRUCTIVE=yes"
      );
      process.exit(1);
    }

    const result = await execute(sql);
    console.log("[editions:prune] applied:");
    console.log(`  users.favorite_card_id cleared: ${result.usersFavCleared}`);
    console.log(`  gifts deleted: ${result.giftsDeleted}`);
    console.log(`  team_members deleted: ${result.teamMembersDeleted}`);
    console.log(`  album_cards deleted: ${result.albumCardsDeleted}`);
    console.log(`  cards deleted: ${result.cardsDeleted}`);
    console.log(`  event_cards deleted: ${result.eventCardsDeleted}`);
    console.log(`  character_editions deleted: ${result.editionsDeleted}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
