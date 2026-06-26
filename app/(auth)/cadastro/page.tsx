import type { Metadata } from "next";
import OnboardingScreen from "@/components/features/onboarding/onboarding-screen";

export const metadata: Metadata = {
  title: "Cadastro | Vimob",
  description: "Crie sua conta no sistema de gestao imobiliaria Vimob",
};

export default function CadastroPage() {
  return <OnboardingScreen />;
}
