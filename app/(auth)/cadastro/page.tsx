import type { Metadata } from "next";
import Link from "next/link";
import OnboardingScreen from "@/components/features/onboarding/onboarding-screen";
import { AuthSplitLayout } from "@/components/features/auth/AuthSplitLayout";

export const metadata: Metadata = {
  title: {
    absolute: "Cadastre-se | Vimob CRM",
  },
  description: "Crie sua conta no sistema de gestao imobiliaria Vimob",
};

export default function CadastroPage() {
  return (
    <AuthSplitLayout
      contentLabel="Cadastro no Vimob CRM"
      heroMedia="video"
      pageClassName="auth-signup-page"
      footer={(
        <p className="w-full px-2 text-center text-[13px] font-light lg:px-4">
          <span className="text-[var(--app-text-tertiary)]">Já tem uma organização? </span>
          <Link
            href="/login"
            className="text-primary outline-none transition-opacity hover:opacity-80"
          >
            Fazer login
          </Link>
        </p>
      )}
    >
      <OnboardingScreen />
    </AuthSplitLayout>
  );
}
