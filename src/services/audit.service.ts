import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";

export async function logAudit(
  userId: number | null,
  action: string,
  details: Record<string, unknown> = {},
  guildId?: string
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      userId,
      action,
      details,
      guildId: guildId ?? null,
    });
  } catch {
    // Audit logging should never break the main flow
  }
}
