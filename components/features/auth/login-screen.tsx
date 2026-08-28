import Link from "next/link";
import { AuthSplitLayout } from "./AuthSplitLayout";
import { LoginForm } from "./login-form";

export default function LoginScreen() {
  return (
    <AuthSplitLayout
      contentLabel="Acesso ao Vimob crm"
      heroMedia="video"
      footer={
        <p className="auth-login-legal w-full px-2 text-center text-[12px] leading-[1.5] lg:text-[11px] text-[var(--app-text-tertiary)] lg:px-4">
          Ao continuar, você concorda com os{" "}
          <Link
            href="/termos-de-uso"
            className="text-primary outline-none transition-opacity hover:opacity-80"
          >
            Termos de Uso
          </Link>{" "}
          e a{" "}
          <Link
            href="/politica-de-privacidade"
            className="text-primary outline-none transition-opacity hover:opacity-80"
          >
            Política de Privacidade
          </Link>
          .
        </p>
      }
    >
      <LoginForm />
    </AuthSplitLayout>
  );
}
