import { AlertCircle, Check, CheckCheck, Clock } from "lucide-react";

export interface MessageStatusProps {
  fromMe: boolean;
  status: string;
  compact?: boolean;
}

export function MessageStatus({ fromMe, status, compact = false }: MessageStatusProps) {
  if (!fromMe) return null;

  const sizeClassName = compact ? "w-[12px] h-[12px]" : "w-[16px] h-[16px]";

  switch (status) {
    case "read":
    case "played":
      return <CheckCheck className={`${sizeClassName} text-blue-400`} role="img" aria-label="Mensagem lida" />;
    case "delivered":
      return <CheckCheck className={`${sizeClassName} opacity-60`} role="img" aria-label="Mensagem entregue" />;
    case "sent":
      return <Check className={`${sizeClassName} opacity-60`} role="img" aria-label="Mensagem enviada" />;
    case "queued":
    case "pending":
      return <Clock className={`${sizeClassName} opacity-60 animate-pulse motion-reduce:animate-none`} role="img" aria-label="Mensagem na fila" />;
    case "sending":
    case "confirming":
      return <Clock className={`${sizeClassName} text-amber-300 animate-pulse motion-reduce:animate-none`} role="img" aria-label="Confirmando envio" />;
    case "unconfirmed":
      return <Clock className={`${sizeClassName} text-amber-300`} role="img" aria-label="Envio não confirmado" />;
    case "failed":
    case "error":
      return <AlertCircle className={`${sizeClassName} text-red-300`} role="img" aria-label="Falha no envio" />;
    default:
      return <Clock className={`${sizeClassName} opacity-60`} role="img" aria-label="Estado do envio indisponível" />;
  }
}
