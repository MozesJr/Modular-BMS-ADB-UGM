// FE/src/proxy.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const AUTH_PAGES = ["/signin", "/signup", "/forgot-password", "/reset-password"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const isExpired =
    token?.expiresAt != null && new Date(token.expiresAt as string) < new Date();
  const isLoggedIn = !!token && !isExpired;
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p));

  if (!isLoggedIn && !isAuthPage) {
    const url = new URL("/signin", req.url);
    if (isExpired) url.searchParams.set("reason", "expired");
    return NextResponse.redirect(url);
  }

  if (isLoggedIn && isAuthPage) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Proteksi khusus: /admin/* cuma boleh diakses role ADMIN
  if (pathname.startsWith("/admin") && token?.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|images).*)"],
};