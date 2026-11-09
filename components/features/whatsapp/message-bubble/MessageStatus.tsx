import { AlertCircle, Check, CheckCheck, Clock } from "lucide-react";

export interface MessageStatusProps {
  fromMe: boolean;
  status: string;
  compact?: boolean;
}

export function MessageStatus({ fromMe, status, compact = false }: MessageStatusProps) {
  if (!fromMe) return null;

  const sizeClassName = compact ? "w-[12px] h-[12px]" : "w-[16px] h-[16px]";
  const iconClassName = `${sizeClassName} shrink-0 motion-safe:transition-[color,opacity] motion-safe:duration-150`;

  switch (status) {
    case "read":
    case "played":
      return <CheckCheck className={`${iconClassName} text-blue-400`} role="img" aria-label="Mensagem lida" />;
    case "delivered":
      return <CheckCheck className={`${iconClassName} opacity-60`} role="img" aria-label="Mensagem entregue" />;
    case "sent":
      return <Check className={`${iconClassName} opacity-60`} role="img" aria-label="Mensagem enviada" />;
    case "queued":
    case "pending":
      return <Clock className={`${iconClassName} opacity-60`} role="img" aria-label="Mensagem na fila" />;
    case "sending":
    case "confirming":
      return <Clock className={`${iconClassName} text-amber-300`} role="img" aria-label="Confirmando envio" />;
    case "unconfirmed":
      return <Clock className={`${iconClassName} text-amber-300`} role="img" aria-label="Envio não confirmado" />;
    case "failed":
    case "error":
      return <AlertCircle className={`${iconClassName} text-red-300`} role="img" aria-label="Falha no envio" />;
    default:
      return <Clock className={`${iconClassName} opacity-60`} role="img" aria-label="Estado do envio indisponível" />;
  }
}
