import sharp from "sharp";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { readFile } from "fs/promises";
import { join } from "path";
import { config } from "../config.js";
import { qualityStars, formatPrint, formatEdition } from "../utils/codes.js";

// ─── Full Card (for /view) ─────────────────────────────
const CARD_W = 350;
const CARD_H = 520;
const BORDER = 14;
const INNER_BORDER = 4;
const INNER_W = CARD_W - BORDER * 2;
const INNER_H = CARD_H - BORDER * 2;
const NAME_AREA_H = 42;
const SERIES_AREA_H = 40;
const IMAGE_H = INNER_H - NAME_AREA_H - SERIES_AREA_H;
const CORNER_R = 14;
const INNER_R = 10;

// ─── Compact Card (for summon embed) ───────────────────
const SC_W = 210;
const SC_H = 300;
const SC_BORDER = 10;
const SC_IB = 3;
const SC_IW = SC_W - SC_BORDER * 2;
const SC_IH = SC_H - SC_BORDER * 2;
const SC_NAME_H = 30;
const SC_SERIES_H = 28;
const SC_IMG_H = SC_IH - SC_NAME_H - SC_SERIES_H;
const SC_R = 10;

// ─── Colors ────────────────────────────────────────────
const QUALITY_FRAME: Record<string, { outer: string; inner: string; accent: string }> = {
  damaged: { outer: "#4a4a4a", inner: "#5a5a5a", accent: "#707070" },
  poor:    { outer: "#787878", inner: "#8a8a8a", accent: "#a0a0a0" },
  good:    { outer: "#556070", inner: "#6a7a8a", accent: "#90b8d4" },
  excellent:{ outer: "#6a4a8a", inner: "#7a5a9a", accent: "#b888e0" },
  pristine: { outer: "#8a7008", inner: "#a88a0a", accent: "#f1c40f" },
  admin:    { outer: "#b8860b", inner: "#daa520", accent: "#ffd700" },
};

const CARD_BG = "#161622";
const TEXT_WHITE = "#FFFFFF";
const PREMIUM_PALETTES = {
  silver: {
    outer: ["#8a8a8a", "#c0c0c0", "#e8e8e8", "#c0c0c0", "#8a8a8a"],
    inner: ["#606060", "#909090", "#b0b0b0", "#909090", "#606060"],
    highlight: "#ffffff",
    shadow: "#404040",
    nameBg: ["#505050", "#707070"],
    nameText: "#ffffff",
    seriesBg: "#404040ee",
    seriesText: "#d0d0d0",
    printBg: "#c0392b",
    printText: "#ffffff",
    sparkle: "#e0e0e0",
    accent: "#a0a0a0",
  },
  gold: {
    outer: ["#8a6914", "#c9a200", "#ffd700", "#c9a200", "#8a6914"],
    inner: ["#6b5200", "#9a7800", "#b8960a", "#9a7800", "#6b5200"],
    highlight: "#fff8dc",
    shadow: "#4a3500",
    nameBg: ["#5a4200", "#7a6200"],
    nameText: "#ffd700",
    seriesBg: "#4a3500ee",
    seriesText: "#f3c861",
    printBg: "#ffd700",
    printText: "#3a2600",
    sparkle: "#ffd700",
    accent: "#c9a200",
  },
  crimson: {
    outer: ["#5a0a0a", "#8b1a1a", "#c0392b", "#8b1a1a", "#5a0a0a"],
    inner: ["#400808", "#6b1010", "#901818", "#6b1010", "#400808"],
    highlight: "#ff8080",
    shadow: "#2a0505",
    nameBg: ["#4a0808", "#6a1010"],
    nameText: "#ff8a8a",
    seriesBg: "#3a0606ee",
    seriesText: "#ffb0b0",
    printBg: "#ff4444",
    printText: "#ffffff",
    sparkle: "#ff6b6b",
    accent: "#c0392b",
  },
  sapphire: {
    outer: ["#0a1a5a", "#1a3a8b", "#2980b9", "#1a3a8b", "#0a1a5a"],
    inner: ["#081040", "#10206b", "#183090", "#10206b", "#081040"],
    highlight: "#80c0ff",
    shadow: "#050a2a",
    nameBg: ["#0a1550", "#102070"],
    nameText: "#7ec8ff",
    seriesBg: "#08103aee",
    seriesText: "#9cd6ff",
    printBg: "#2980b9",
    printText: "#ffffff",
    sparkle: "#5dade2",
    accent: "#2980b9",
  },
} as const;
const SUMMON_FRAME_BY_QUALITY: Record<string, string> = {
  damaged: "frame-minimalist.png",
  poor: "frame-dark-gothic.png",
  good: "frame-sakura-bloom.png",
  excellent: "frame-frost-crystal.png",
  pristine: "frame-elegant-gold.png",
};
const FALLBACK_SUMMON_FRAME = "frame-neon-cyber.png";
const summonFrameCache = new Map<string, Buffer>();
const DETERMINISTIC_FRAME_STYLES: Array<"silver" | "gold" | "crimson" | "sapphire"> = [
  "silver",
  "gold",
  "crimson",
  "sapphire",
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getDeterministicFrameStyle(cardCode: string): "silver" | "gold" | "crimson" | "sapphire" {
  if (!cardCode) return "silver";
  return DETERMINISTIC_FRAME_STYLES[hashString(cardCode) % DETERMINISTIC_FRAME_STYLES.length];
}

// ─── Public Types ──────────────────────────────────────

export interface RenderCardParams {
  cardCode?: string;
  characterImage: Buffer;
  name: string;
  series: string;
  quality: string;
  printNumber: number;
  editionNumber: number;
  frame?: Buffer;
  frameStyle?: "silver" | "gold" | "crimson" | "sapphire";
  tag?: string;
  tagEmoji?: string;
  isAdminExclusive?: boolean;
  textScale?: number;
}

export interface RenderSummonParams {
  cards: [RenderCardParams, RenderCardParams, RenderCardParams];
  summonerName: string;
}

// ─── Single Card Renderer ──────────────────────────────

export async function renderCard(params: RenderCardParams): Promise<Buffer> {
  const canvas = createCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext("2d");
  const resolvedStyle =
    params.frameStyle
      ?? (params.cardCode ? getDeterministicFrameStyle(params.cardCode) : undefined);
  const palette =
    params.isAdminExclusive
      ? PREMIUM_PALETTES.gold
      : resolvedStyle === "gold"
      ? PREMIUM_PALETTES.gold
      : resolvedStyle === "crimson"
      ? PREMIUM_PALETTES.crimson
      : resolvedStyle === "sapphire"
      ? PREMIUM_PALETTES.sapphire
      : resolvedStyle === "silver"
      ? PREMIUM_PALETTES.silver
      : params.quality === "pristine"
      ? PREMIUM_PALETTES.gold
      : params.quality === "excellent"
      ? PREMIUM_PALETTES.sapphire
      : params.quality === "poor" || params.quality === "damaged"
      ? PREMIUM_PALETTES.silver
      : PREMIUM_PALETTES.crimson;

  const textScale = params.textScale ?? 1;
  const bannerH = Math.round(44 * textScale);
  const barH = Math.round(52 * textScale);
  const innerX = BORDER;
  const innerY = BORDER + bannerH;
  const innerW = CARD_W - BORDER * 2;
  const innerH = CARD_H - BORDER * 2 - bannerH - barH;

  // Outer metallic frame
  roundRect(ctx, 0, 0, CARD_W, CARD_H, CORNER_R);
  const baseGrad = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  baseGrad.addColorStop(0, palette.outer[0]);
  baseGrad.addColorStop(0.25, palette.outer[1]);
  baseGrad.addColorStop(0.5, palette.outer[2]);
  baseGrad.addColorStop(0.75, palette.outer[3]);
  baseGrad.addColorStop(1, palette.outer[4]);
  ctx.fillStyle = baseGrad;
  ctx.fill();

  // Bevel light/shadow
  ctx.save();
  roundRect(ctx, 0, 0, CARD_W, CARD_H, CORNER_R);
  ctx.clip();
  const hlGrad = ctx.createLinearGradient(0, 0, CARD_W * 0.5, CARD_H * 0.5);
  hlGrad.addColorStop(0, `${palette.highlight}50`);
  hlGrad.addColorStop(0.5, "transparent");
  ctx.fillStyle = hlGrad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();

  ctx.save();
  roundRect(ctx, 0, 0, CARD_W, CARD_H, CORNER_R);
  ctx.clip();
  const shGrad = ctx.createLinearGradient(CARD_W * 0.5, CARD_H * 0.5, CARD_W, CARD_H);
  shGrad.addColorStop(0, "transparent");
  shGrad.addColorStop(1, `${palette.shadow}60`);
  ctx.fillStyle = shGrad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();

  // Recessed image window shadow
  ctx.save();
  ctx.shadowColor = "#00000080";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  roundRect(ctx, innerX, innerY, innerW, innerH, INNER_R);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();

  roundRect(ctx, innerX - 1, innerY - 1, innerW + 2, innerH + 2, INNER_R + 1);
  ctx.strokeStyle = `${palette.highlight}35`;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Character image
  try {
    const charImg = await loadImage(params.characterImage);
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, innerX, innerY, innerW, innerH, INNER_R);
    ctx.clip();

    const scale = Math.max(innerW / charImg.width, innerH / charImg.height);
    const sw = charImg.width * scale;
    const sh = charImg.height * scale;
    ctx.drawImage(charImg, innerX + (innerW - sw) / 2, innerY + (innerH - sh) / 2, sw, sh);

    const vig = ctx.createRadialGradient(
      innerX + innerW / 2,
      innerY + innerH / 2,
      innerW * 0.3,
      innerX + innerW / 2,
      innerY + innerH / 2,
      innerW * 0.85
    );
    vig.addColorStop(0, "transparent");
    vig.addColorStop(1, "rgba(0,0,0,0.28)");
    ctx.fillStyle = vig;
    ctx.fillRect(innerX, innerY, innerW, innerH);
    ctx.restore();
  } catch {
    ctx.fillStyle = "#222238";
    roundRect(ctx, innerX, innerY, innerW, innerH, INNER_R);
    ctx.fill();
    ctx.fillStyle = "#666";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Image unavailable", CARD_W / 2, innerY + innerH / 2);
  }

  // Frame overlay
  if (params.frame) {
    try {
      const frameImg = await loadImage(params.frame);
      ctx.drawImage(frameImg, 0, 0, CARD_W, CARD_H);
    } catch { /* skip */ }
  }

  // Name banner
  const bannerY = BORDER - 2;
  const bannerGrad = ctx.createLinearGradient(BORDER, bannerY, BORDER, bannerY + bannerH);
  bannerGrad.addColorStop(0, palette.nameBg[0]);
  bannerGrad.addColorStop(1, palette.nameBg[1]);
  ctx.fillStyle = bannerGrad;
  roundRect(ctx, BORDER, bannerY, innerW, bannerH, { tl: INNER_R, tr: INNER_R, bl: 0, br: 0 });
  ctx.fill();

  ctx.strokeStyle = `${palette.accent}40`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(BORDER + 5, bannerY + bannerH);
  ctx.lineTo(BORDER + innerW - 5, bannerY + bannerH);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.round(18 * textScale)}px sans-serif`;
  const nameText = truncate(ctx, params.name, innerW - 20);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillText(nameText, CARD_W / 2 + 1, bannerY + bannerH / 2 + 1);
  ctx.fillStyle = palette.nameText;
  ctx.fillText(nameText, CARD_W / 2, bannerY + bannerH / 2 + 1);

  // Small banner sparkles
  ctx.fillStyle = `${palette.sparkle}90`;
  ctx.beginPath();
  ctx.moveTo(BORDER + 8, bannerY + bannerH / 2 - 4);
  ctx.lineTo(BORDER + 10, bannerY + bannerH / 2);
  ctx.lineTo(BORDER + 8, bannerY + bannerH / 2 + 4);
  ctx.lineTo(BORDER + 6, bannerY + bannerH / 2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(CARD_W - BORDER - 8, bannerY + bannerH / 2 - 4);
  ctx.lineTo(CARD_W - BORDER - 6, bannerY + bannerH / 2);
  ctx.lineTo(CARD_W - BORDER - 8, bannerY + bannerH / 2 + 4);
  ctx.lineTo(CARD_W - BORDER - 10, bannerY + bannerH / 2);
  ctx.closePath();
  ctx.fill();

  // Series bar
  const seriesY = innerY + innerH;
  ctx.fillStyle = palette.seriesBg;
  roundRect(ctx, BORDER, seriesY, innerW, barH, { tl: 0, tr: 0, bl: INNER_R, br: INNER_R });
  ctx.fill();

  ctx.font = `${Math.round(13 * textScale)}px sans-serif`;
  ctx.fillStyle = palette.seriesText;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const seriesText = truncate(ctx, params.series, innerW - 90);
  ctx.fillText(seriesText, BORDER + 10, seriesY + barH / 2 + 1);

  // Print badge
  const badgeText = `#${params.printNumber}`;
  ctx.font = `bold ${Math.round(15 * textScale)}px sans-serif`;
  const badgeW = ctx.measureText(badgeText).width + 16;
  const badgeH = Math.round(28 * textScale);
  const badgeX = BORDER + innerW - badgeW - 6;
  const badgeY = seriesY + (barH - badgeH) / 2;
  const badgeGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX, badgeY + badgeH);
  badgeGrad.addColorStop(0, palette.printBg);
  badgeGrad.addColorStop(1, `${palette.printBg}cc`);
  ctx.fillStyle = badgeGrad;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 5);
  ctx.fill();
  ctx.strokeStyle = "#ffffff20";
  ctx.lineWidth = 0.75;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 5);
  ctx.stroke();
  ctx.fillStyle = palette.printText;
  ctx.textAlign = "center";
  ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 1);

  // Edition marker near print badge
  const edText = `◑${params.editionNumber}`;
  ctx.font = `${Math.round(12 * textScale)}px sans-serif`;
  ctx.fillStyle = `${palette.seriesText}b0`;
  ctx.textAlign = "right";
  ctx.fillText(edText, badgeX - 8, seriesY + barH / 2 + 1);

  // ── Admin Exclusive ribbon (diagonal corner banner) ──
  if (params.isAdminExclusive) {
    ctx.save();
    // Gold diagonal ribbon top-left
    ctx.translate(CARD_W - 10, 10);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = "#ffd700";
    ctx.fillRect(-50, -10, 100, 20);
    ctx.fillStyle = "#000";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("⭐ EXCLUSIVE", 0, 0);
    ctx.restore();

    // Gold shimmer border (double frame effect)
    ctx.strokeStyle = "#ffd700";
    ctx.lineWidth = 2;
    roundRect(ctx, 3, 3, CARD_W - 6, CARD_H - 6, CORNER_R - 1);
    ctx.stroke();
  }

  // Outer and inner definition lines
  roundRect(ctx, 1, 1, CARD_W - 2, CARD_H - 2, CORNER_R);
  ctx.strokeStyle = `${palette.shadow}80`;
  ctx.lineWidth = 1;
  ctx.stroke();
  roundRect(ctx, innerX - 1, innerY - 1, innerW + 2, innerH + 2, INNER_R);
  ctx.strokeStyle = `${palette.shadow}60`;
  ctx.stroke();

  return Buffer.from(canvas.toBuffer("image/png"));
}

// ─── Compact Card (for summon embeds) ──────────────────

/** Render a compact card for the summon image. */
export async function renderSummonCard(params: RenderCardParams): Promise<Buffer> {
  const full = await renderCard({ ...params, textScale: 1.35 });
  return sharp(full).resize(SC_W, SC_H, { fit: "fill" }).png().toBuffer();
}

// ─── Mystery Card (compact) ───────────────────────────

export async function renderMysteryCard(): Promise<Buffer> {
  const canvas = createCanvas(SC_W, SC_H);
  const ctx = canvas.getContext("2d");
  const p = PREMIUM_PALETTES.silver;

  // Premium silver frame so mystery slot visually matches summon cards.
  drawFrameAt(ctx, 0, 0, SC_W, SC_H, SC_R, SC_BORDER, "#6a6a74");

  const ib = SC_BORDER - SC_IB;
  roundRect(ctx, ib, ib, SC_W - ib * 2, SC_H - ib * 2, SC_R - 2);
  ctx.fillStyle = "#50505a";
  ctx.fill();

  const nameH = 34;
  const barH = 36;
  const innerX = SC_BORDER;
  const innerY = SC_BORDER + nameH;
  const innerW = SC_IW;
  const innerH = SC_IH - nameH - barH;

  // Name bar
  const nameGrad = ctx.createLinearGradient(innerX, SC_BORDER, innerX, SC_BORDER + nameH);
  nameGrad.addColorStop(0, p.nameBg[0]);
  nameGrad.addColorStop(1, p.nameBg[1]);
  ctx.fillStyle = nameGrad;
  roundRect(ctx, innerX, SC_BORDER, innerW, nameH, { tl: SC_R - 4, tr: SC_R - 4, bl: 0, br: 0 });
  ctx.fill();

  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f2f4ff";
  ctx.fillText("MYSTERY", SC_W / 2, SC_BORDER + nameH / 2 + 1);

  // Main hidden area
  roundRect(ctx, innerX, innerY, innerW, innerH, 6);
  const grad = ctx.createLinearGradient(0, innerY, 0, innerY + innerH);
  grad.addColorStop(0, "#252734");
  grad.addColorStop(0.55, "#1c1f2b");
  grad.addColorStop(1, "#252734");
  ctx.fillStyle = grad;
  ctx.fill();

  // Soft center glow
  const glow = ctx.createRadialGradient(SC_W / 2, innerY + innerH / 2, 8, SC_W / 2, innerY + innerH / 2, innerW * 0.45);
  glow.addColorStop(0, "rgba(190, 200, 230, 0.20)");
  glow.addColorStop(1, "rgba(190, 200, 230, 0)");
  ctx.fillStyle = glow;
  roundRect(ctx, innerX, innerY, innerW, innerH, 6);
  ctx.fill();

  // Main icon stack
  ctx.fillStyle = "rgba(185, 195, 220, 0.88)";
  ctx.font = "bold 70px sans-serif";
  ctx.fillText("?", SC_W / 2, innerY + innerH / 2 - 18);
  ctx.fillStyle = "rgba(150, 165, 205, 0.7)";
  ctx.font = "bold 42px sans-serif";
  ctx.fillText("🔒", SC_W / 2, innerY + innerH / 2 + 38);

  // Bottom bar
  ctx.fillStyle = "rgba(58, 62, 74, 0.95)";
  roundRect(ctx, innerX, innerY + innerH, innerW, barH, { tl: 0, tr: 0, bl: SC_R - 4, br: SC_R - 4 });
  ctx.fill();
  ctx.font = "bold 11px sans-serif";
  ctx.fillStyle = "#d7dcef";
  ctx.fillText("Reveal on grab", SC_W / 2, innerY + innerH + barH / 2 + 1);

  return Buffer.from(canvas.toBuffer("image/png"));
}

// ─── Fusion Token Card (compact) ──────────────────────

export async function renderFusionTokenCard(amount: number): Promise<Buffer> {
  const canvas = createCanvas(SC_W, SC_H);
  const ctx = canvas.getContext("2d");

  // Reddish-pink accent frame
  drawFrameAt(ctx, 0, 0, SC_W, SC_H, SC_R, SC_BORDER, "#c03060");

  const ib = SC_BORDER - SC_IB;
  roundRect(ctx, ib, ib, SC_W - ib * 2, SC_H - ib * 2, SC_R - 2);
  ctx.fillStyle = "#a02848";
  ctx.fill();

  // Dark inner with red glow
  roundRect(ctx, SC_BORDER, SC_BORDER, SC_IW, SC_IH, SC_R - 4);
  const grad = ctx.createRadialGradient(SC_W / 2, SC_H / 2, 20, SC_W / 2, SC_H / 2, SC_H * 0.6);
  grad.addColorStop(0, "#4a1028");
  grad.addColorStop(0.6, "#2a0818");
  grad.addColorStop(1, "#1a0410");
  ctx.fillStyle = grad;
  ctx.fill();

  // Draw magic circle rings
  ctx.strokeStyle = "rgba(220, 60, 100, 0.3)";
  ctx.lineWidth = 1.5;
  const cx = SC_W / 2;
  const cy = SC_H / 2;

  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, 65, 0, Math.PI * 2);
  ctx.stroke();

  // Middle ring
  ctx.strokeStyle = "rgba(220, 60, 100, 0.4)";
  ctx.beginPath();
  ctx.arc(cx, cy, 45, 0, Math.PI * 2);
  ctx.stroke();

  // Inner ring
  ctx.strokeStyle = "rgba(255, 80, 120, 0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 25, 0, Math.PI * 2);
  ctx.stroke();

  // Cross lines through center
  ctx.strokeStyle = "rgba(220, 60, 100, 0.25)";
  ctx.lineWidth = 1;
  for (let angle = 0; angle < Math.PI; angle += Math.PI / 6) {
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * 65, cy + Math.sin(angle) * 65);
    ctx.lineTo(cx - Math.cos(angle) * 65, cy - Math.sin(angle) * 65);
    ctx.stroke();
  }

  // Star points on middle ring
  ctx.fillStyle = "rgba(255, 80, 120, 0.5)";
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * 45;
    const py = cy + Math.sin(a) * 45;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Center glow dot
  const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 15);
  glowGrad.addColorStop(0, "rgba(255, 100, 140, 0.6)");
  glowGrad.addColorStop(1, "rgba(255, 100, 140, 0)");
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, 15, 0, Math.PI * 2);
  ctx.fill();

  return Buffer.from(canvas.toBuffer("image/png"));
}

// ─── Combined Summon Image (3 compact cards) ───────────

const SUMMON_GAP = 10;
const SUMMON_PADDING = 4;

export async function renderSummonImage(
  card1: Buffer,
  card2: Buffer,
  mysteryCard: Buffer
): Promise<Buffer> {
  const totalW = SUMMON_PADDING * 2 + SC_W * 3 + SUMMON_GAP * 2;
  const totalH = SUMMON_PADDING * 2 + SC_H;

  const bg = sharp({
    create: {
      width: totalW,
      height: totalH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png();

  const x1 = SUMMON_PADDING;
  const x2 = SUMMON_PADDING + SC_W + SUMMON_GAP;
  const x3 = SUMMON_PADDING + (SC_W + SUMMON_GAP) * 2;
  const y = SUMMON_PADDING;

  return bg
    .composite([
      { input: card1, left: x1, top: y },
      { input: card2, left: x2, top: y },
      { input: mysteryCard, left: x3, top: y },
    ])
    .toBuffer();
}

/**
 * Load a character image from local storage, falling back to URL download.
 */
export async function loadCharacterImage(
  imagePath: string,
  fallbackUrl?: string | null
): Promise<Buffer> {
  try {
    const fullPath = join(config.IMAGE_DIR, imagePath);
    return await readFile(fullPath);
  } catch {
    if (fallbackUrl) {
      const res = await fetch(fallbackUrl);
      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      }
    }
    throw new Error(`Failed to load image: ${imagePath}`);
  }
}

// ─── Drawing Helpers ───────────────────────────────────

/** Draw metallic frame for full-size cards. */
function drawFrame(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  r: number, tint: string
) {
  drawFrameAt(ctx, x, y, w, h, r, BORDER, tint);
}

/** Draw metallic frame with configurable border width. */
function drawFrameAt(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  r: number, border: number, tint: string
) {
  roundRect(ctx, x, y, w, h, r);
  const grad = ctx.createLinearGradient(x, y, x + w * 0.3, y + h);
  grad.addColorStop(0, "#c8c8cc");
  grad.addColorStop(0.15, tint);
  grad.addColorStop(0.35, "#404048");
  grad.addColorStop(0.5, tint);
  grad.addColorStop(0.65, "#606068");
  grad.addColorStop(0.85, tint);
  grad.addColorStop(1, "#c8c8cc");
  ctx.fillStyle = grad;
  ctx.fill();

  roundRect(ctx, x + 2, y + 2, w - 4, h * 0.5, r - 1);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fill();

  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, r - 1);
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  roundRect(ctx, x + border - 1, y + border - 1, w - (border - 1) * 2, h - (border - 1) * 2, r - 3);
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | { tl: number; tr: number; br: number; bl: number }
) {
  const radii = typeof r === "number" ? { tl: r, tr: r, br: r, bl: r } : r;
  ctx.beginPath();
  ctx.moveTo(x + radii.tl, y);
  ctx.lineTo(x + w - radii.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radii.tr);
  ctx.lineTo(x + w, y + h - radii.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radii.br, y + h);
  ctx.lineTo(x + radii.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radii.bl);
  ctx.lineTo(x, y + radii.tl);
  ctx.quadraticCurveTo(x, y, x + radii.tl, y);
  ctx.closePath();
}

function roundRectTop(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function roundRectBottom(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y);
  ctx.closePath();
}

function truncate(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (ctx.measureText(t + "…").width > maxWidth && t.length > 0) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

async function getSummonFrameOverlay(quality: string): Promise<Buffer | null> {
  const filename = SUMMON_FRAME_BY_QUALITY[quality] ?? FALLBACK_SUMMON_FRAME;
  const cacheKey = `summon_border:${filename}`;
  const cached = summonFrameCache.get(cacheKey);
  if (cached) return cached;

  try {
    const framePath = join(process.cwd(), "assets", "frames", filename);
    const frameRaw = await readFile(framePath);
    const frameImg = await loadImage(frameRaw);

    // Build border-only overlay so opaque centers don't hide character art.
    const frameCanvas = createCanvas(SC_W, SC_H);
    const frameCtx = frameCanvas.getContext("2d");
    frameCtx.drawImage(frameImg, 0, 0, SC_W, SC_H);
    frameCtx.globalCompositeOperation = "destination-out";
    roundRect(frameCtx, SC_BORDER + 2, SC_BORDER + 2, SC_IW - 4, SC_IH - 4, SC_R - 5);
    frameCtx.fillStyle = "#000";
    frameCtx.fill();

    const borderOnly = Buffer.from(frameCanvas.toBuffer("image/png"));
    summonFrameCache.set(cacheKey, borderOnly);
    return borderOnly;
  } catch {
    return null;
  }
}

async function getSummonFrameOverlayByStyle(
  style: "silver" | "gold" | "crimson" | "sapphire"
): Promise<Buffer | null> {
  const styleToFile: Record<"silver" | "gold" | "crimson" | "sapphire", string> = {
    silver: "frame-minimalist.png",
    gold: "frame-elegant-gold.png",
    crimson: "frame-dark-gothic.png",
    sapphire: "frame-frost-crystal.png",
  };
  const filename = styleToFile[style];
  const cacheKey = `summon_border:${filename}`;
  const cached = summonFrameCache.get(cacheKey);
  if (cached) return cached;
  try {
    const framePath = join(process.cwd(), "assets", "frames", filename);
    const frameRaw = await readFile(framePath);
    const frameImg = await loadImage(frameRaw);
    const frameCanvas = createCanvas(SC_W, SC_H);
    const frameCtx = frameCanvas.getContext("2d");
    frameCtx.drawImage(frameImg, 0, 0, SC_W, SC_H);
    frameCtx.globalCompositeOperation = "destination-out";
    roundRect(frameCtx, SC_BORDER + 2, SC_BORDER + 2, SC_IW - 4, SC_IH - 4, SC_R - 5);
    frameCtx.fillStyle = "#000";
    frameCtx.fill();
    const borderOnly = Buffer.from(frameCanvas.toBuffer("image/png"));
    summonFrameCache.set(cacheKey, borderOnly);
    return borderOnly;
  } catch {
    return null;
  }
}
