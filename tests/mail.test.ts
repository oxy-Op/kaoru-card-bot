/**
 * Mail service integration tests.
 * Tests send, inbox retrieval, read, markAllRead, delete.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  testDb,
  seedUser,
  cleanup,
  closeDb,
} from "./setup.js";
import {
  sendMail,
  getInbox,
  readMail,
  markAllRead,
  deleteMail,
  getUnreadCount,
} from "../src/services/mail.service.js";

const DISCORD_M = "test_mail_user_999";
let userId: number;

beforeAll(async () => {
  userId = await seedUser(DISCORD_M, "mailUser");
}, 15_000);

afterAll(async () => {
  await cleanup();
  await closeDb();
}, 30_000);

describe("sendMail + getInbox", () => {
  it("sends mail and appears in inbox", async () => {
    await sendMail(userId, "Welcome!", "You joined the bot.", "system");

    const inbox = await getInbox(DISCORD_M, 1, 10);
    expect(inbox.total).toBeGreaterThanOrEqual(1);
    expect(inbox.messages.some((m) => m.subject === "Welcome!")).toBe(true);
  });

  it("new mail is unread", async () => {
    await sendMail(userId, "Unread Test", "This is unread.", "system");

    const inbox = await getInbox(DISCORD_M, 1, 50);
    const msg = inbox.messages.find((m) => m.subject === "Unread Test");
    expect(msg).toBeTruthy();
    expect(msg!.read).toBe(false);
    expect(inbox.unread).toBeGreaterThanOrEqual(1);
  });

  it("paginates correctly", async () => {
    for (let i = 0; i < 5; i++) {
      await sendMail(userId, `Page Test ${i}`, `Body ${i}`, "system");
    }

    const page1 = await getInbox(DISCORD_M, 1, 3);
    const page2 = await getInbox(DISCORD_M, 2, 3);

    expect(page1.messages.length).toBeLessThanOrEqual(3);
    expect(page2.messages.length).toBeGreaterThanOrEqual(1);
    expect(page1.page).toBe(1);
    expect(page2.page).toBe(2);
  });

  it("returns empty inbox for unknown user", async () => {
    const inbox = await getInbox("unknown_mail_user_999");
    expect(inbox.total).toBe(0);
    expect(inbox.messages).toEqual([]);
  });
});

describe("readMail", () => {
  it("marks a message as read and returns it", async () => {
    await sendMail(userId, "Read Me", "Read this.", "system");

    const inbox = await getInbox(DISCORD_M, 1, 50);
    const msg = inbox.messages.find((m) => m.subject === "Read Me")!;
    expect(msg).toBeTruthy();

    const read = await readMail(DISCORD_M, msg.id);
    expect(read).toBeTruthy();
    expect(read!.read).toBe(true);
    expect(read!.subject).toBe("Read Me");
  });

  it("returns null for non-existent mail", async () => {
    const result = await readMail(DISCORD_M, 999999);
    expect(result).toBeNull();
  });

  it("returns null for unknown user", async () => {
    const result = await readMail("unknown_user_999", 1);
    expect(result).toBeNull();
  });
});

describe("markAllRead", () => {
  it("marks all messages as read", async () => {
    await sendMail(userId, "Bulk 1", "b1", "system");
    await sendMail(userId, "Bulk 2", "b2", "system");

    const count = await markAllRead(DISCORD_M);
    expect(count).toBeGreaterThanOrEqual(2);

    const unread = await getUnreadCount(DISCORD_M);
    expect(unread).toBe(0);
  });
});

describe("deleteMail", () => {
  it("deletes a specific message", async () => {
    await sendMail(userId, "Delete Me", "goodbye", "system");
    const inbox = await getInbox(DISCORD_M, 1, 50);
    const msg = inbox.messages.find((m) => m.subject === "Delete Me")!;

    const deleted = await deleteMail(DISCORD_M, msg.id);
    expect(deleted).toBe(true);

    const afterInbox = await getInbox(DISCORD_M, 1, 50);
    expect(afterInbox.messages.find((m) => m.id === msg.id)).toBeUndefined();
  });

  it("returns false for non-existent message", async () => {
    const result = await deleteMail(DISCORD_M, 999999);
    expect(result).toBe(false);
  });
});

describe("getUnreadCount", () => {
  it("returns 0 when all read", async () => {
    await markAllRead(DISCORD_M);
    expect(await getUnreadCount(DISCORD_M)).toBe(0);
  });

  it("returns correct count after new mail", async () => {
    await markAllRead(DISCORD_M);
    await sendMail(userId, "New1", "n1", "system");
    await sendMail(userId, "New2", "n2", "system");

    expect(await getUnreadCount(DISCORD_M)).toBe(2);
  });

  it("returns 0 for unknown user", async () => {
    expect(await getUnreadCount("ghost_user_999")).toBe(0);
  });
});
