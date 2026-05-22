import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  cleanup,
  closeDb,
  seedGuild,
  seedUser,
  testDb,
} from "./setup.js";
import { petalTransactions } from "../src/db/schema.js";
import {
  creditPetals,
  debitPetals,
  getPetalBalance,
  getPetalHistory,
} from "../src/services/petals.service.js";

const DISCORD_ID = "test_petals_user_999";
let userId: number;

beforeAll(async () => {
  await seedGuild("test_guild");
  userId = await seedUser(DISCORD_ID, "petalsUser");
  await creditPetals({
    discordId: DISCORD_ID,
    username: "petalsUser",
    amount: 1,
    reason: "bootstrap",
    idempotencyKey: "petals:test:bootstrap",
    source: "test",
  });
  await debitPetals({
    discordId: DISCORD_ID,
    username: "petalsUser",
    amount: 1,
    reason: "bootstrap_reset",
    idempotencyKey: "petals:test:bootstrap-reset",
    source: "test",
  });
}, 15_000);

afterAll(async () => {
  await cleanup();
  await closeDb();
}, 30_000);

describe("petals ledger", () => {
  it("credits petals and writes a ledger row", async () => {
    const result = await creditPetals({
      discordId: DISCORD_ID,
      username: "petalsUser",
      amount: 120,
      reason: "admin_grant",
      idempotencyKey: "petals:test:credit:1",
      source: "test",
      metadata: { note: "initial top-up" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.applied).toBe(true);
    expect(result.balanceAfter).toBe(120);
    expect(result.entry.amount).toBe(120);
    expect(result.entry.direction).toBe("credit");

    const bal = await getPetalBalance(DISCORD_ID, "petalsUser");
    expect(bal).toBe(120);
  });

  it("enforces idempotency for duplicate credit key", async () => {
    const first = await creditPetals({
      discordId: DISCORD_ID,
      username: "petalsUser",
      amount: 50,
      reason: "duplicate_test",
      idempotencyKey: "petals:test:credit:dup",
      source: "test",
    });
    expect(first.success).toBe(true);

    const second = await creditPetals({
      discordId: DISCORD_ID,
      username: "petalsUser",
      amount: 9999,
      reason: "duplicate_test",
      idempotencyKey: "petals:test:credit:dup",
      source: "test",
    });
    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.applied).toBe(false);

    const history = await getPetalHistory(DISCORD_ID, "petalsUser", 10);
    const dupRows = history.filter((h) => h.idempotencyKey === "petals:test:credit:dup");
    expect(dupRows.length).toBe(1);
  });

  it("debits petals with balance guard and signed ledger amounts", async () => {
    const ok = await debitPetals({
      discordId: DISCORD_ID,
      username: "petalsUser",
      amount: 60,
      reason: "shop_purchase",
      idempotencyKey: "petals:test:debit:1",
      source: "test",
    });
    expect(ok.success).toBe(true);
    if (!ok.success) return;
    expect(ok.applied).toBe(true);
    expect(ok.entry.amount).toBe(-60);
    expect(ok.entry.direction).toBe("debit");

    const beforeFailBalance = await getPetalBalance(DISCORD_ID, "petalsUser");
    const fail = await debitPetals({
      discordId: DISCORD_ID,
      username: "petalsUser",
      amount: 999_999,
      reason: "overspend",
      idempotencyKey: "petals:test:debit:too-much",
      source: "test",
    });
    expect(fail.success).toBe(false);
    const afterFailBalance = await getPetalBalance(DISCORD_ID, "petalsUser");
    expect(afterFailBalance).toBe(beforeFailBalance);
  });

  it("returns ordered history for user", async () => {
    const history = await getPetalHistory(DISCORD_ID, "petalsUser", 5);
    expect(history.length).toBeGreaterThan(0);
    for (let i = 1; i < history.length; i++) {
      expect(history[i - 1].id).toBeGreaterThan(history[i].id);
    }
  });

  it("table rows are queryable from schema for integration confidence", async () => {
    const rows = await testDb
      .select({
        id: petalTransactions.id,
        userId: petalTransactions.userId,
        amount: petalTransactions.amount,
      })
      .from(petalTransactions)
      .where(eq(petalTransactions.userId, userId));
    expect(rows.length).toBeGreaterThan(0);
  });
});
