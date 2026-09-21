import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyCredentials } from "@/lib/credentials";

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
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.expiresAt = user.expiresAt ? user.expiresAt.toISOString() : null;
        token.tv = user.tokenVersion;
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
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
});