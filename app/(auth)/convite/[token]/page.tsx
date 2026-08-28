import type { Metadata } from "next";
import { AuthShell } from "@/components/features/auth/auth-shell";
import { InvitationScreen } from "@/components/features/auth/invitation-screen";
import { PublicQueryProvider } from "@/components/providers/public-query-provider";
import { normalizeInvitationToken } from "@/lib/auth/invitation";

export const metadata: Metadata = {
  title: "Convite | Vimob",
  description: "Aceite seu convite para acessar o Vimob CRM",
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  const token = normalizeInvitationToken(rawToken);
  return (
    <AuthShell>
      <PublicQueryProvider>
        <InvitationScreen token={token} />
      </PublicQueryProvider>
    </AuthShell>
  );
}
