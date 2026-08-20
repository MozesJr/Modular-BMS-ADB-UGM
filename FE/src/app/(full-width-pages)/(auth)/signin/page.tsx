import SignInForm from "@/components/auth/SignInForm";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "BMS ADB SignIn Page",
  description: "This is BMS ADB Signin Page Modular Universal BMS Dashboard",
};

export default function SignIn() {
  return <SignInForm />;
}
