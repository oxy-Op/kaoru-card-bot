import path from "path";
import fs from "fs";

/** Resolved absolute base for local card/edition images (Turbopack-safe cwd join). */
export function getResolvedImageBase(): string {
  const configured = process.env.IMAGE_DIR?.trim();
  if (configured) {
    if (path.isAbsolute(configured)) return configured;
    if (configured === "./data/images" || configured === "data/images") {
      const candidates = [
        path.join(/* turbopackIgnore: true */ process.cwd(), "data", "images"),
        path.join(/* turbopackIgnore: true */ process.cwd(), "..", "data", "images"),
        path.join(/* turbopackIgnore: true */ process.cwd(), "..", "..", "data", "images"),
        path.join(/* turbopackIgnore: true */ process.cwd(), "..", "..", "..", "data", "images"),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
      }
      return candidates[0];
    }
    return path.resolve(
      /* turbopackIgnore: true */ process.cwd(),
      configured
    );
  }

  const cwdBase = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "data",
    "images"
  );
  const repoBase = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "..",
    "data",
    "images"
  );

  // In web dev, cwd is often `<repo>/web`; prefer repo root image dir when present.
  if (fs.existsSync(repoBase) && !fs.existsSync(cwdBase)) {
    return repoBase;
  }
  return cwdBase;
}
