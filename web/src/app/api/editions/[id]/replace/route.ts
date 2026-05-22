import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterEditions, users, auditLog } from "@shared/db/schema";
import { eq } from "drizzle-orm";
import { withRole } from "@/lib/api-auth";
import fs from "fs/promises";
import path from "path";
import { getResolvedImageBase } from "@/lib/image-storage";
import { normalizeImagePath } from "@/lib/image-path";

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

  const formData = await req.formData();
  const file = formData.get("image") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No image file provided" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const fullPath = path.join(getResolvedImageBase(), normalizeImagePath(edition.imagePath));

  // Archive old image
  try {
    await fs.access(fullPath);
    await fs.rename(fullPath, fullPath + ".bak");
  } catch {
    // Old file doesn't exist, that's fine
  }

  // Write new image
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);

  const adminUser = await db.query.users.findFirst({
    where: eq(users.discordId, ctx.user.discordId),
    columns: { id: true },
  });

  await db.insert(auditLog).values({
    userId: adminUser?.id ?? null,
    action: "edition_replace_image",
    details: {
      editionId: id,
      characterId: edition.characterId,
      editionNumber: edition.editionNumber,
      imagePath: edition.imagePath,
    },
  });

  return NextResponse.json({ ok: true });
});
