import SignInForm from "@/components/auth/SignInForm";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "GAMA BMS SignIn Page",
  description: "This is GAMA BMS Signin Page Modular Universal BMS Dashboard",
};

export default function SignIn() {
  return <SignInForm />;
}
