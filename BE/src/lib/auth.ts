import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyCredentials } from "@/lib/credentials";
import { evaluateJwtIdle, idleConfig, idleDeadlineSec, remainingIdleSec } from "@/lib/session-idle";
import { extendSessionIdle } from "@/lib/ws-hub";

class AccountExpiredError extends CredentialsSignin {
  code = "account_expired";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  // pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const result = await verifyCredentials(email, password);
        if (!result.ok) {
          if (result.reason === "expired") throw new AccountExpiredError();
          return null;
        }
        return result.user;
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger }) {
      const nowSec = Math.floor(Date.now() / 1000);
      const { timeoutSec } = idleConfig();
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.expiresAt = user.expiresAt ? user.expiresAt.toISOString() : null;
        token.tv = user.tokenVersion;
        token.sid = crypto.randomUUID();
        token.ida = idleDeadlineSec(nowSec, timeoutSec);
        return token;
      }

      // Batas idle ditegakkan di sini untuk SETIAP pembacaan sesi (auth() di REST dan /api/auth/session). Klaim `ida`
      // hanya dimajukan oleh update() eksplisit dari FE (interaksi user); pembacaan lain membawanya apa adanya, jadi
      // polling/refetch otomatis tidak memperpanjang sesi. null = Auth.js menghapus cookie dan sesi dianggap tidak ada.
      const decision = evaluateJwtIdle({ deadlineSec: token.ida, nowSec, timeoutSec, explicitTouch: trigger === "update" });
      if (decision.kind === "expired") return null;
      if (decision.extended) {
        token.ida = decision.deadlineSec;
        // Koneksi /ws milik SESI ini ikut diperpanjang supaya user aktif tidak terputus (sesi lain tidak ikut).
        if (token.id && token.sid) extendSessionIdle(token.id, token.sid, decision.deadlineSec * 1000);
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.tokenVersion = token.tv ?? 0; // JWT lama (sebelum ada tv) dianggap versi 0
        (session.user as unknown as Record<string, unknown>).expiresAt = token.expiresAt;
      }
      const { timeoutSec, warningSec } = idleConfig();
      session.idle = { timeoutSec, warningSec, remainingSec: remainingIdleSec(token.ida, Math.floor(Date.now() / 1000)) };
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
});