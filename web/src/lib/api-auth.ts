import { NextRequest, NextResponse } from "next/server";
import { auth, type AdminRole } from "./auth";
import { hasRole } from "./roles";

export interface AuthContext {
  user: {
    discordId: string;
    role: AdminRole;
    username: string;
  };
}

type AuthHandler = (
  req: NextRequest,
  ctx: AuthContext & { params?: any }
) => Promise<NextResponse>;

/**
 * Wrap an API route handler with auth + role check.
 * Usage: export const POST = withRole("curator", async (req, ctx) => { ... });
 */
export function withRole(minRole: AdminRole, handler: AuthHandler) {
  return async (req: NextRequest, routeCtx?: { params?: any }) => {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const user = session.user as any;
    if (!user.discordId || !user.role) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    if (!hasRole(user.role, minRole)) {
      return NextResponse.json(
        { error: `Requires ${minRole} role or higher` },
        { status: 403 }
      );
    }

    const ctx: AuthContext & { params?: any } = {
      user: {
        discordId: user.discordId,
        role: user.role,
        username: user.username,
      },
      params: routeCtx?.params,
    };

    return handler(req, ctx);
  };
}

/**
 * Wrap an API route handler with just auth (any role).
 */
export function withAuth(handler: AuthHandler) {
  return withRole("viewer", handler);
}
