import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  // Discord
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_DEV_GUILD_ID: z.string().optional(),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Bot Config
  DEFAULT_PREFIX: z.string().default("k!"),
  SUMMON_COOLDOWN_SEC: z.coerce.number().default(1200),
  GRAB_COOLDOWN_SEC: z.coerce.number().default(600),
  ACTIVITY_SPAWN_THRESHOLD: z.coerce.number().default(5),
  MYSTERY_CARD_CHANCE: z.coerce.number().default(0.01),

  // Dev
  DEV_USER_IDS: z.string().default(""),
  ENABLE_PRIVATE_ADMIN_REVIEW: z.coerce.boolean().default(false),

  // Image Storage
  IMAGE_DIR: z.string().default("./data/images"),
  CARD_CACHE_DIR: z.string().default("./data/cache"),
});

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;

const devIds = new Set(config.DEV_USER_IDS.split(",").map((s) => s.trim()).filter(Boolean));
export function isDevUser(discordId: string): boolean {
  return devIds.has(discordId);
}
