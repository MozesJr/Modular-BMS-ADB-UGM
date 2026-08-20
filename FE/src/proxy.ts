import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";


const AUTH_PAGES = ["/signin", "/signup", "/forgot-password", "/reset-password"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });
  const isLoggedIn = !!token;
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p));

  // Belum login, coba akses halaman selain auth → lempar ke /signin
  if (!isLoggedIn && !isAuthPage) {
    return NextResponse.redirect(new URL("/signin", req.url));
  }

  // Sudah login, tapi masih coba buka /signin atau /signup → lempar ke dashboard
  if (isLoggedIn && isAuthPage) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // jalan di semua route KECUALI file static/asset/api
    "/((?!api|_next/static|_next/image|favicon.ico|images).*)",
  ],
};