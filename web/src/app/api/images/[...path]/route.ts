import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getResolvedImageBase } from "@/lib/image-storage";
import { normalizeImagePath } from "@/lib/image-path";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const segments = (await params).path;
  const normalizedPath = normalizeImagePath(segments.join("/"));
  const parts = normalizedPath.split("/").filter(Boolean);
  if (parts.some((p) => p === "." || p === "..")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cwd = /* turbopackIgnore: true */ process.cwd();
  const baseCandidates = [
    getResolvedImageBase(),
    path.join(cwd, "data", "images"),
    path.join(cwd, "..", "data", "images"),
    path.join(cwd, "..", "..", "data", "images"),
  ];

  for (const base of baseCandidates) {
    const filePath = path.resolve(path.join(base, ...parts));
    const baseResolved = path.resolve(base);
    if (!filePath.startsWith(baseResolved)) continue;
    try {
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

      return new NextResponse(buffer, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch {
      // Try next candidate base path.
    }
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
