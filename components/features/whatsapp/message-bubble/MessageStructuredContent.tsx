import { useState } from "react";
import { Copy, MapPin, UserRound } from "lucide-react";
import { getSafeExternalHttpUrl } from "../message-media";
import { getMessageAuthorPresentation } from "@/components/features/whatsapp/message-bubble/message-author-model";
import { copyTextToClipboard } from "@/lib/clipboard";

export type MessageContactCard = { display_name: string; phones?: string[] };
export type MessageLocation = { latitude: number; longitude: number; name?: string; address?: string };
export type MessageQuotedPreview = {
  message_id: string; available: boolean; id?: string; from_me?: boolean;
  content?: string; message_type?: string; sender_name?: string; sender_user_id?: string | null; media_filename?: string;
};
export function MessageStructuredContent({ contacts, location }: {
  contacts?: MessageContactCard[] | null; location?: MessageLocation | null;
}) {
  const [feedback, setFeedback] = useState("");
  const copy = async (text: string) => {
    try {
      const copied = await copyTextToClipboard(text, { preserveWhitespace: true });
      setFeedback(copied ? "Copiado." : "Não foi possível copiar. Selecione o texto para copiar.");
    }
    catch { setFeedback("Não foi possível copiar. Selecione o texto para copiar."); }
  };
  const validLocation = location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
    && Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180;
  const coordinates = validLocation ? `${location.latitude}, ${location.longitude}` : "";
  const mapUrl = validLocation ? getSafeExternalHttpUrl(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`) : null;
  if (!contacts?.length && !location) return null;
  return (
    <div className="mb-2 flex min-w-0 flex-col gap-2 text-[12px] font-[200]">
      {contacts?.slice(0, 5).map((contact, index) => (
        <div key={index} className="rounded-md bg-current/5 p-2">
          <div className="flex items-center gap-2"><UserRound className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="break-words">{contact.display_name.slice(0, 160) || "Contato compartilhado"}</span></div>
          {(contact.phones || []).slice(0, 5).map((phone, phoneIndex) => {
            const number = /^\+?[\d() .-]{1,32}$/.test(phone) ? phone.replace(/[^+\d]/g, "") : null;
            return <p key={phoneIndex} className="mt-1 break-all" style={{ fontWeight: "inherit" }}>{number ? <a href={`tel:${number}`} className="underline">{phone}</a> : phone.slice(0, 32)}</p>;
          })}
          <button type="button" className="mt-1 inline-flex items-center gap-1 rounded px-1 py-1 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => void copy([contact.display_name, ...(contact.phones || [])].join("\n"))} aria-label={`Copiar contato ${contact.display_name}`}><Copy className="h-3 w-3" aria-hidden="true" />Copiar contato</button>
        </div>
      ))}
      {location && <div className="rounded-md bg-current/5 p-2">
        <p className="flex items-center gap-2" style={{ fontWeight: "inherit" }}><MapPin className="h-4 w-4" aria-hidden="true" />{location.name || "Localização compartilhada"}</p>
        {location.address && <p className="mt-1 break-words" style={{ fontWeight: "inherit" }}>{location.address}</p>}
        {mapUrl ? <div className="mt-1 flex flex-wrap gap-3"><a href={mapUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="underline">Abrir mapa</a><button type="button" className="underline" onClick={() => void copy(coordinates)}>Copiar coordenadas</button></div> : <p style={{ fontWeight: "inherit" }}>Coordenadas indisponíveis.</p>}
      </div>}
      {feedback && <p role="status" className="text-xs">{feedback}</p>}
    </div>
  );
}

export function MessageQuotePreview({ quote, viewerUserId, onNavigate }: { quote: MessageQuotedPreview; viewerUserId?: string | null; onNavigate?: (id: string) => void }) {
  if (!quote.available) return <blockquote className="mb-2 border-l-2 border-current/40 pl-2 text-xs opacity-75">Mensagem citada indisponível</blockquote>;
  const labels: Record<string, string> = { audio: "Áudio", image: "Imagem", video: "Vídeo", document: "Documento", sticker: "Figurinha" };
  const text = quote.content || quote.media_filename || labels[quote.message_type || ""] || "Mensagem citada";
  const author = getMessageAuthorPresentation({ fromMe: quote.from_me === true, senderName: quote.sender_name, senderUserId: quote.sender_user_id, viewerUserId });
  const preview = <><span className="block text-xs font-medium">{author.bubbleSenderLabel}</span><span className="block line-clamp-3 whitespace-pre-wrap break-words text-xs">{text.slice(0, 500)}</span></>;
  return quote.id && onNavigate ? <button type="button" className="mb-2 block w-full rounded border-l-2 border-current/40 bg-current/5 p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => onNavigate(quote.id!)} aria-label="Ir para mensagem citada">{preview}</button>
    : <blockquote className="mb-2 rounded border-l-2 border-current/40 bg-current/5 p-2">{preview}</blockquote>;
}
