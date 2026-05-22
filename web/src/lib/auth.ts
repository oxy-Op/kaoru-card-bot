import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { db } from "./db";
import { adminUsers } from "@shared/db/schema";
import { eq } from "drizzle-orm";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      authorization: { params: { scope: "identify" } },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (!account || !profile) return false;

      const discordId = account.providerAccountId;
      const admin = await db.query.adminUsers.findFirst({
        where: eq(adminUsers.discordId, discordId),
      });

      // Only allow sign-in if the user is in admin_users
      if (!admin) return false;

      // Update username if it changed
      if (admin.username !== (profile as any).username) {
        await db
          .update(adminUsers)
          .set({ username: (profile as any).username ?? profile.name ?? "unknown", updatedAt: new Date() })
          .where(eq(adminUsers.discordId, discordId));
      }

      return true;
    },
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.discordId = account.providerAccountId;

        const admin = await db.query.adminUsers.findFirst({
          where: eq(adminUsers.discordId, account.providerAccountId),
        });
        token.role = admin?.role ?? "viewer";
        token.username = (profile as any).username ?? profile?.name ?? "unknown";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).discordId = token.discordId;
        (session.user as any).role = token.role;
        (session.user as any).username = token.username;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});

export type AdminRole = "owner" | "admin" | "curator" | "viewer";

export interface AdminSession {
  user: {
    discordId: string;
    role: AdminRole;
    username: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}
