import type { InferSelectModel } from "drizzle-orm";
import { eq, and, desc, lt, count } from "drizzle-orm";
import { db } from "../db/index.js";
import { mail, users } from "../db/schema.js";

export type MailRow = InferSelectModel<typeof mail>;

export async function sendMail(
  recipientId: number,
  subject: string,
  body: string,
  category: string = "system",
  metadata: Record<string, unknown> = {},
  expiresInDays: number = 30
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  await db.insert(mail).values({
    recipientId,
    subject,
    body,
    category,
    metadata,
    expiresAt,
  });
}

export async function getInbox(
  discordId: string,
  page: number = 1,
  pageSize: number = 10
): Promise<{
  messages: MailRow[];
  total: number;
  unread: number;
  page: number;
  totalPages: number;
}> {
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, discordId),
    columns: { id: true },
  });
  if (!user) return { messages: [], total: 0, unread: 0, page: 1, totalPages: 0 };

  await db
    .delete(mail)
    .where(and(eq(mail.recipientId, user.id), lt(mail.expiresAt, new Date())));

  const [{ total }] = await db
    .select({ total: count() })
    .from(mail)
    .where(eq(mail.recipientId, user.id));

  const [{ unread }] = await db
    .select({ unread: count() })
    .from(mail)
    .where(and(eq(mail.recipientId, user.id), eq(mail.read, false)));

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * pageSize;

  const messages = await db
    .select()
    .from(mail)
    .where(eq(mail.recipientId, user.id))
    .orderBy(desc(mail.createdAt))
    .limit(pageSize)
    .offset(offset);

  return { messages, total, unread, page: safePage, totalPages };
}

export async function readMail(discordId: string, mailId: number): Promise<MailRow | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, discordId),
    columns: { id: true },
  });
  if (!user) return null;

  const [message] = await db
    .select()
    .from(mail)
    .where(and(eq(mail.id, mailId), eq(mail.recipientId, user.id)))
    .limit(1);
  if (!message) return null;

  if (!message.read) {
    await db.update(mail).set({ read: true }).where(eq(mail.id, mailId));
    return { ...message, read: true };
  }

  return message;
}

export async function markAllRead(discordId: string): Promise<number> {
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, discordId),
    columns: { id: true },
  });
  if (!user) return 0;

  const updated = await db
    .update(mail)
    .set({ read: true })
    .where(and(eq(mail.recipientId, user.id), eq(mail.read, false)))
    .returning({ id: mail.id });

  return updated.length;
}

export async function deleteMail(discordId: string, mailId: number): Promise<boolean> {
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, discordId),
    columns: { id: true },
  });
  if (!user) return false;

  const removed = await db
    .delete(mail)
    .where(and(eq(mail.id, mailId), eq(mail.recipientId, user.id)))
    .returning({ id: mail.id });

  return removed.length > 0;
}

export async function getUnreadCount(discordId: string): Promise<number> {
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, discordId),
    columns: { id: true },
  });
  if (!user) return 0;

  const [{ unread }] = await db
    .select({ unread: count() })
    .from(mail)
    .where(and(eq(mail.recipientId, user.id), eq(mail.read, false)));

  return unread;
}
