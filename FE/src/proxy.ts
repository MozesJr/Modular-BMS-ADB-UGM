// FE/src/proxy.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { buildSignInUrl, type SignInReason } from "@/lib/callbackUrl";
import { evaluateSession, isLoggedIn } from "@/lib/sessionState";

const AUTH_PAGES = ["/signin", "/signup", "/forgot-password", "/reset-password"];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  // SATU keputusan untuk semua cabang: sesi idle/expired/lama dianggap BELUM login (termasuk saat membuka halaman auth),
  // sehingga /signin tidak memantul ke "/" selama cookie idle masih tersimpan di browser. Deadline idle dihitung server
  // (klaim `ida`); FE tidak punya konfigurasi idle sendiri.
  const state = evaluateSession(token, Date.now());
  const loggedIn = isLoggedIn(state);
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p));

  if (!loggedIn && !isAuthPage) {
    const reason: SignInReason | undefined =
      state.status === "expired" ? "expired" : state.status === "idle" ? (state.legacy ? "expired" : "idle") : undefined;
    return NextResponse.redirect(new URL(buildSignInUrl({ reason, from: `${pathname}${search}` }), req.url));
  }

  if (loggedIn && isAuthPage) {
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
