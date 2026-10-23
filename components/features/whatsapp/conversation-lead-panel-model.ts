import { formatWhatsAppPersonName } from "@/lib/whatsapp-person-name";

type AuxiliaryRead = { isLoading: boolean; isError: boolean };
type Assignee = { name?: string | null; email?: string | null };
type LinkedProperty = { id: string; code?: string | null; title?: string | null };

/** A missing catalog entry is not evidence that the persisted link is empty. */
export function getConversationAssigneeLabel(id: string | null | undefined, user: Assignee | null | undefined, read: AuxiliaryRead) {
  if (!id) return "Sem responsável";
  const name = formatWhatsAppPersonName(user?.name) || user?.email?.trim();
  if (name) return name;
  if (read.isLoading) return "Carregando responsável…";
  if (read.isError) return "Responsável indisponível";
  return "Responsável vinculado";
}

export function getConversationPropertyLabel(id: string | null | undefined, property: LinkedProperty | null | undefined,
  read: AuxiliaryRead & { canView: boolean }) {
  if (!id) return "Nenhum";
  if (!read.canView) return "Imóvel vinculado";
  if (property?.id === id) {
    const code = property.code || "";
    const full = code ? `${code} - ${property.title || "Sem título"}` : property.title || "Sem título";
    return full.length > code.length + 13 ? `${full.slice(0, code.length + 13)}...` : full;
  }
  if (read.isLoading) return "Carregando imóvel…";
  if (read.isError) return "Imóvel indisponível";
  return "Imóvel vinculado";
}
