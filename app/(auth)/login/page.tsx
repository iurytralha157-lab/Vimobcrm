import type { Metadata } from "next";
import LoginScreen from "@/components/features/auth/login-screen";

export const metadata: Metadata = {
  title: "Login | Vimob",
  description: "Acesse seu sistema de gestao imobiliaria",
};

export default function LoginPage() {
  return <LoginScreen />;
}
