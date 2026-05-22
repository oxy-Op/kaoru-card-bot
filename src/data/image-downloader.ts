import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { config } from "../config.js";

/**
 * Download an image from URL and save to local storage.
 * Returns the relative path to the saved image, or null on failure.
 */
export async function downloadImage(
  url: string,
  relativePath: string
): Promise<string | null> {
  try {
    const fullPath = join(config.IMAGE_DIR, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });

    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[ImageDL] Failed to fetch ${url}: ${res.status}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(fullPath, buffer);

    return relativePath;
  } catch (err) {
    console.error(
      `[ImageDL] Error downloading ${url}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
