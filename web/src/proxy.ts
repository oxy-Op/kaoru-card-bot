import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const session = await auth();

  const isLoginPage = request.nextUrl.pathname === "/login";
  const isAuthApi = request.nextUrl.pathname.startsWith("/api/auth");
  const isPublicImageApi = request.nextUrl.pathname.startsWith("/api/images/");
  const isStaticAsset =
    request.nextUrl.pathname.startsWith("/_next") ||
    request.nextUrl.pathname === "/favicon.ico";

  if (isLoginPage || isAuthApi || isPublicImageApi || isStaticAsset) {
    return NextResponse.next();
  }

  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
