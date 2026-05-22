import sharp from "sharp";

/** Downscale to tiny then nearest-neighbor upscale → pixel art effect. */
export async function generatePixelArt(src: Buffer): Promise<Buffer> {
  return sharp(src)
    .resize(48, 48, { kernel: "nearest" })
    .resize(480, 480, { kernel: "nearest" })
    .png()
    .toBuffer();
}
