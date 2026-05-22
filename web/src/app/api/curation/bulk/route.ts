import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pendingEditions, users, auditLog } from "@shared/db/schema";
import { eq, inArray } from "drizzle-orm";
import { withRole } from "@/lib/api-auth";

export const POST = withRole("curator", async (req, ctx) => {
  const body = await req.json();
  const { ids, action, reason } = body as {
    ids: number[];
    action: "approve" | "reject";
    reason?: string;
  };

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "No IDs provided" }, { status: 400 });
  }
  if (ids.length > 50) {
    return NextResponse.json({ error: "Max 50 items per batch" }, { status: 400 });
  }
  if (!["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const adminUser = await db.query.users.findFirst({
    where: eq(users.discordId, ctx.user.discordId),
    columns: { id: true },
  });

  const newStatus = action === "approve" ? "approved" : "rejected";

  await db
    .update(pendingEditions)
    .set({
      status: newStatus,
      rejectionReason: action === "reject" ? (reason ?? "bulk reject") : null,
      reviewedBy: adminUser?.id ?? null,
      reviewedAt: new Date(),
    })
    .where(inArray(pendingEditions.id, ids));

  await db.insert(auditLog).values({
    userId: adminUser?.id ?? null,
    action: `curation_bulk_${action}`,
    details: { ids, reason },
  });

  return NextResponse.json({ ok: true, count: ids.length });
});
