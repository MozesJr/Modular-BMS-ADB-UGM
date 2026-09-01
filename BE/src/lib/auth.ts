import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

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

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        if (user.expiresAt && user.expiresAt < new Date()) {
          throw new AccountExpiredError();
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          expiresAt: user.expiresAt,
        };
      },
    }),
  ],
  callbacks: {
jwt({ token, user }) {
  if (user) {
    token.id = user.id as string;
    token.role = user.role;
    token.expiresAt = user.expiresAt ? user.expiresAt.toISOString() : null;
  }
  return token;
},
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        (session.user as unknown as Record<string, unknown>).expiresAt = token.expiresAt;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
});