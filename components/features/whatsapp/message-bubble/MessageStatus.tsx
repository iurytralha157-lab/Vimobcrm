import { AlertCircle, Check, CheckCheck, Clock } from "lucide-react";

export interface MessageStatusProps {
  fromMe: boolean;
  status: string;
}

export function MessageStatus({ fromMe, status }: MessageStatusProps) {
  if (!fromMe) return null;

  switch (status) {
    case "read":
    case "played":
      return <CheckCheck className="w-[16px] h-[16px] text-blue-400" role="img" aria-label="Mensagem lida" />;
    case "delivered":
      return <CheckCheck className="w-[16px] h-[16px] opacity-60" role="img" aria-label="Mensagem entregue" />;
    case "sent":
      return <Check className="w-[16px] h-[16px] opacity-60" role="img" aria-label="Mensagem enviada" />;
    case "queued":
    case "pending":
      return <Clock className="w-[16px] h-[16px] opacity-60 animate-pulse" role="img" aria-label="Mensagem na fila" />;
    case "sending":
    case "confirming":
      return <Clock className="w-[16px] h-[16px] text-amber-300 animate-pulse" role="img" aria-label="Confirmando envio" />;
    case "failed":
    case "error":
      return <AlertCircle className="w-[16px] h-[16px] text-red-300" role="img" aria-label="Falha no envio" />;
    default:
      return <Check className="w-[16px] h-[16px] opacity-60" role="img" aria-label="Mensagem enviada" />;
  }
}
