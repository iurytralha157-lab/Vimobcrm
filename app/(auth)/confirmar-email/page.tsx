import type { Metadata } from "next";
import { AuthSplitLayout } from "@/components/features/auth/AuthSplitLayout";
import EmailConfirmationScreen from "@/components/features/auth/EmailConfirmationScreen";

export const metadata: Metadata = {
  title: {
    absolute: "Confirmar e-mail | Vimob crm",
  },
  description: "Confirme o e-mail usado no cadastro do Vimob",
};

export default function ConfirmarEmailPage() {
  return (
    <AuthSplitLayout contentLabel="Confirmação de e-mail do Vimob crm">
      <EmailConfirmationScreen />
    </AuthSplitLayout>
  );
}
