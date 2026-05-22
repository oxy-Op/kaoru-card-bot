import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  pendingEditions,
  characterEditions,
  characters,
  users,
  auditLog,
} from "@shared/db/schema";
import { eq, count } from "drizzle-orm";
import { withRole } from "@/lib/api-auth";
import fs from "fs/promises";
import path from "path";

const IMAGE_DIR = process.env.IMAGE_DIR ?? "./data/images";

export const POST = withRole("curator", async (req, ctx) => {
  const id = parseInt((await ctx.params).id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

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

  // Determine next edition number
  const [{ edCount }] = await db
    .select({ edCount: count() })
    .from(characterEditions)
    .where(eq(characterEditions.characterId, pending.characterId));
  const nextEdition = edCount + 1;

  // Move image to final location
  const destDir = path.join(IMAGE_DIR, "characters", String(pending.characterId));
  const destFile = `ed${nextEdition}.png`;
  const destPath = path.join(destDir, destFile);

  if (pending.imagePath) {
    try {
      await fs.mkdir(destDir, { recursive: true });
      await fs.copyFile(pending.imagePath, destPath);
    } catch (err) {
      console.error("Image copy failed:", err);
    }
  }

  // Create edition
  const relativePath = `characters/${pending.characterId}/${destFile}`;
  await db.insert(characterEditions).values({
    characterId: pending.characterId,
    editionNumber: nextEdition,
    imagePath: relativePath,
    generationMethod: "original",
    rarityWeight: 1.0,
    artistName: pending.artistName,
    artistUrl: pending.artistUrl,
    sourceUrl: pending.sourceUrl,
  });

  // Look up the curator's user ID for the audit log
  const adminUser = await db.query.users.findFirst({
    where: eq(users.discordId, ctx.user.discordId),
    columns: { id: true },
  });

  // Update pending status
  await db
    .update(pendingEditions)
    .set({
      status: "approved",
      reviewedBy: adminUser?.id ?? null,
      reviewedAt: new Date(),
    })
    .where(eq(pendingEditions.id, id));

  // Audit log
  await db.insert(auditLog).values({
    userId: adminUser?.id ?? null,
    action: "curation_approve",
    details: {
      pendingEditionId: id,
      characterId: pending.characterId,
      editionNumber: nextEdition,
    },
  });

  return NextResponse.json({ ok: true, editionNumber: nextEdition });
});
