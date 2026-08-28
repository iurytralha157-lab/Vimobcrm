import type { Metadata } from "next";
import LoginScreen from "@/components/features/auth/login-screen";

export const metadata: Metadata = {
  title: {
    absolute: "Entrar | Vimob crm",
  },
  description: "Acesse seu sistema de gestão imobiliária",
};

export default function LoginPage() {
  return <LoginScreen />;
}
