import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterEditions, users, auditLog } from "@shared/db/schema";
import { eq } from "drizzle-orm";
import { withRole } from "@/lib/api-auth";

export const POST = withRole("curator", async (req, ctx) => {
  const id = parseInt((await ctx.params).id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const [edition] = await db
    .select()
    .from(characterEditions)
    .where(eq(characterEditions.id, id))
    .limit(1);

  if (!edition) {
    return NextResponse.json({ error: "Edition not found" }, { status: 404 });
  }

  await db
    .update(characterEditions)
    .set({ summonable: false })
    .where(eq(characterEditions.id, id));

  const adminUser = await db.query.users.findFirst({
    where: eq(users.discordId, ctx.user.discordId),
    columns: { id: true },
  });

  await db.insert(auditLog).values({
    userId: adminUser?.id ?? null,
    action: "edition_remove",
    details: {
      editionId: id,
      characterId: edition.characterId,
      editionNumber: edition.editionNumber,
    },
  });

  return NextResponse.json({ ok: true });
});
