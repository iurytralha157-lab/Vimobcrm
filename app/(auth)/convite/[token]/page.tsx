import type { Metadata } from "next";
import { InvitationScreen } from "@/components/features/auth/invitation-screen";

export const metadata: Metadata = {
  title: "Convite | Vimob",
  description: "Aceite seu convite para acessar o Vimob CRM",
};

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InvitationScreen token={token} />;
}
