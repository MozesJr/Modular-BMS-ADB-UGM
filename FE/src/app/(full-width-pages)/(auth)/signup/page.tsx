import SignUpForm from "@/components/auth/SignUpForm";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "BMS ADB SignUp Page",
  description: "This is BMS ADB SignUp Page Modular Universal BMS Dashboard",
  // other metadata
};

export default function SignUp() {
  return <SignUpForm />;
}
