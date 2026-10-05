import SignInForm from "@/components/auth/SignInForm";
import { sanitizeCallbackUrl } from "@/lib/callbackUrl";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "GAMA BMS SignIn Page",
  description: "This is GAMA BMS Signin Page Modular Universal BMS Dashboard",
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[]; callbackUrl?: string | string[] }>;
}) {
  const { reason, callbackUrl } = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const r = first(reason);
  return (
    <SignInForm
      reason={r === "idle" || r === "expired" ? r : undefined}
      callbackUrl={sanitizeCallbackUrl(first(callbackUrl)) ?? undefined}
    />
  );
}
