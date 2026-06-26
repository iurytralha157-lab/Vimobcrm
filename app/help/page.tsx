import type { Metadata } from "next";

import PublicHelpScreen from "@/components/features/help/PublicHelpScreen";

export const metadata: Metadata = {
  title: "Central de Ajuda | Vimob",
  description:
    "Central de ajuda pública do Vimob com guias de primeiros passos, conteúdos do CRM e dúvidas frequentes.",
};

export default function HelpPage() {
  return <PublicHelpScreen />;
}
