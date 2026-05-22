import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { petalTransactions, users } from "../db/schema.js";
import { ensureUser } from "./summon.service.js";
import { logAudit } from "./audit.service.js";

export interface PetalLedgerEntry {
  id: number;
  userId: number;
  amount: number;
  balanceAfter: number;
  direction: "credit" | "debit";
  reason: string;
  source: string;
  idempotencyKey: string;
  externalRef: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

interface PetalMutationInput {
  discordId: string;
  username: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  source?: string;
  externalRef?: string | null;
  metadata?: Record<string, unknown>;
}

type PetalMutationResult =
  | { success: true; applied: boolean; balanceAfter: number; entry: PetalLedgerEntry }
  | { success: false; reason: string };

async function getExistingByIdempotency(
  idempotencyKey: string
): Promise<PetalLedgerEntry | null> {
  const [existing] = await db
    .select()
    .from(petalTransactions)
    .where(eq(petalTransactions.idempotencyKey, idempotencyKey))
    .limit(1);
  return (existing as PetalLedgerEntry | undefined) ?? null;
}

function validateInput(input: PetalMutationInput): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, reason: "Amount must be a positive number." };
  }
  if (!input.reason.trim()) {
    return { ok: false, reason: "Reason is required." };
  }
  if (!input.idempotencyKey.trim()) {
    return { ok: false, reason: "Idempotency key is required." };
  }
  return { ok: true };
}

export async function getPetalBalance(
  discordId: string,
  username = "unknown"
): Promise<number> {
  const userId = await ensureUser(discordId, username);
  const [row] = await db
    .select({ petals: users.opals })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.petals ?? 0;
}

export async function getPetalHistory(
  discordId: string,
  username = "unknown",
  limit = 20
): Promise<PetalLedgerEntry[]> {
  const userId = await ensureUser(discordId, username);
  return await db
    .select()
    .from(petalTransactions)
    .where(eq(petalTransactions.userId, userId))
    .orderBy(desc(petalTransactions.id))
    .limit(Math.max(1, Math.min(100, limit))) as PetalLedgerEntry[];
}

export async function creditPetals(input: PetalMutationInput): Promise<PetalMutationResult> {
  const valid = validateInput(input);
  if (!valid.ok) return { success: false, reason: valid.reason };

  const existing = await getExistingByIdempotency(input.idempotencyKey);
  if (existing) {
    return { success: true, applied: false, balanceAfter: existing.balanceAfter, entry: existing };
  }

  const userId = await ensureUser(input.discordId, input.username);
  const source = input.source?.trim() || "internal";
  const metadata = input.metadata ?? {};

  const txResult = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({ opals: sql`${users.opals} + ${input.amount}` })
      .where(eq(users.id, userId))
      .returning({ balanceAfter: users.opals });

    const [entry] = await tx
      .insert(petalTransactions)
      .values({
        userId,
        amount: input.amount,
        balanceAfter: updated.balanceAfter,
        direction: "credit",
        reason: input.reason.trim(),
        source,
        idempotencyKey: input.idempotencyKey.trim(),
        externalRef: input.externalRef ?? null,
        metadata,
      })
      .returning();

    return { balanceAfter: updated.balanceAfter, entry: entry as PetalLedgerEntry };
  });

  await logAudit(userId, "petals_credit", {
    amount: input.amount,
    balanceAfter: txResult.balanceAfter,
    reason: input.reason,
    source,
    idempotencyKey: input.idempotencyKey,
    externalRef: input.externalRef ?? null,
  });

  return { success: true, applied: true, balanceAfter: txResult.balanceAfter, entry: txResult.entry };
}

export async function debitPetals(input: PetalMutationInput): Promise<PetalMutationResult> {
  const valid = validateInput(input);
  if (!valid.ok) return { success: false, reason: valid.reason };

  const existing = await getExistingByIdempotency(input.idempotencyKey);
  if (existing) {
    return { success: true, applied: false, balanceAfter: existing.balanceAfter, entry: existing };
  }

  const userId = await ensureUser(input.discordId, input.username);
  const source = input.source?.trim() || "internal";
  const metadata = input.metadata ?? {};

  const txResult = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({ opals: sql`${users.opals} - ${input.amount}` })
      .where(and(eq(users.id, userId), sql`${users.opals} >= ${input.amount}`))
      .returning({ balanceAfter: users.opals });

    if (!updated) {
      return null;
    }

    const [entry] = await tx
      .insert(petalTransactions)
      .values({
        userId,
        amount: -input.amount,
        balanceAfter: updated.balanceAfter,
        direction: "debit",
        reason: input.reason.trim(),
        source,
        idempotencyKey: input.idempotencyKey.trim(),
        externalRef: input.externalRef ?? null,
        metadata,
      })
      .returning();

    return { balanceAfter: updated.balanceAfter, entry: entry as PetalLedgerEntry };
  });

  if (!txResult) {
    return { success: false, reason: "Insufficient petals balance." };
  }

  await logAudit(userId, "petals_debit", {
    amount: input.amount,
    balanceAfter: txResult.balanceAfter,
    reason: input.reason,
    source,
    idempotencyKey: input.idempotencyKey,
    externalRef: input.externalRef ?? null,
  });

  return { success: true, applied: true, balanceAfter: txResult.balanceAfter, entry: txResult.entry };
}
