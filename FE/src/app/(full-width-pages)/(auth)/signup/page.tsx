import SignUpForm from "@/components/auth/SignUpForm";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "GAMA BMS SignUp Page",
  description: "This is GAMA BMS SignUp Page Modular Universal BMS Dashboard",
  // other metadata
};

export default function SignUp() {
  return <SignUpForm />;
}
