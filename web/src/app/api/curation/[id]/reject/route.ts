import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pendingEditions, users, auditLog } from "@shared/db/schema";
import { eq } from "drizzle-orm";
import { withRole } from "@/lib/api-auth";

export const POST = withRole("curator", async (req, ctx) => {
  const id = parseInt((await ctx.params).id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const body = await req.json();
  const reason = body.reason ?? "unspecified";

  const [pending] = await db
    .select()
    .from(pendingEditions)
    .where(eq(pendingEditions.id, id))
    .limit(1);

  if (!pending) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (pending.status !== "pending") {
    return NextResponse.json({ error: "Already reviewed" }, { status: 400 });
  }

  const adminUser = await db.query.users.findFirst({
    where: eq(users.discordId, ctx.user.discordId),
    columns: { id: true },
  });

  await db
    .update(pendingEditions)
    .set({
      status: reason === "copyright" || reason === "dmca" ? "dmca" : "rejected",
      rejectionReason: reason,
      reviewedBy: adminUser?.id ?? null,
      reviewedAt: new Date(),
    })
    .where(eq(pendingEditions.id, id));

  await db.insert(auditLog).values({
    userId: adminUser?.id ?? null,
    action: "curation_reject",
    details: {
      pendingEditionId: id,
      characterId: pending.characterId,
      reason,
    },
  });

  return NextResponse.json({ ok: true });
});
