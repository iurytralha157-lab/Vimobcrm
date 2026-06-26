import { useLeadMessages, LeadMessage } from '@/hooks/use-lead-messages';
import { MessageBubble } from '@/components/features/whatsapp/MessageBubble';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageCircle, Loader2, LogIn } from 'lucide-react';
import { format, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface LeadMessagesTabProps {
  leadId: string;
  leadName: string;
}

function DateSeparator({ date }: { date: Date }) {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[11px] text-muted-foreground font-medium px-2">
        {format(date, "dd 'de' MMMM, yyyy", { locale: ptBR })}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function SessionJoinedBanner({ userName, time }: { userName: string; time: string }) {
  return (
    <div className="flex items-center justify-center gap-2 my-3">
      <div className="flex items-center gap-1.5 bg-accent/50 text-accent-foreground/70 rounded-full px-3 py-1 text-[11px]">
        <LogIn className="h-3 w-3" />
        <span className="font-medium">{userName}</span>
        <span>entrou na conversa</span>
        <span className="text-[10px] opacity-60">· {format(new Date(time), 'HH:mm')}</span>
      </div>
    </div>
  );
}

function getSenderDisplay(msg: LeadMessage): string {
  if (msg.from_me) {
    // If sender_name is set (e.g., "Automação", or the user's name typed in Evolution)
    if (msg.sender_name) return msg.sender_name;
    // Fallback to session owner name
    if (msg.session_owner_name) return msg.session_owner_name;
    return 'Enviada';
  }
  return '';
}

type MessageMediaStatus = 'pending' | 'ready' | 'failed' | null;

const toMessageMediaStatus = (status: LeadMessage['media_status']): MessageMediaStatus => {
  return status === 'pending' || status === 'ready' || status === 'failed' ? status : null;
};

function MessageBubbleWrapper({ msg, leadName, leadId }: { msg: LeadMessage; leadName: string; leadId: string }) {
  const senderLabel = msg.from_me ? getSenderDisplay(msg) : leadName;

  return (
    <MessageBubble
      content={msg.content}
      messageType={msg.message_type || 'text'}
      mediaUrl={msg.media_url ?? null}
      mediaMimeType={msg.media_mime_type ?? null}
      mediaStatus={toMessageMediaStatus(msg.media_status)}
      mediaError={msg.media_error ?? null}
      mediaSize={msg.media_size}
      fromMe={msg.from_me}
      status={msg.status || ''}
      sentAt={msg.sent_at}
      senderName={msg.from_me ? senderLabel : null}
      isGroup={false}
      onRetryMedia={() => {}}
      messageId={msg.id}
      leadId={leadId}
      leadName={leadName}
      reactions={[]}
    />
  );
}

export function LeadMessagesTab({ leadId, leadName }: LeadMessagesTabProps) {
  const { data: messages = [], isLoading } = useLeadMessages(leadId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
        <MessageCircle className="h-8 w-8" />
        <p className="text-sm">Nenhuma mensagem registrada</p>
        <p className="text-xs">As mensagens WhatsApp aparecerão aqui quando houver conversas vinculadas a este lead.</p>
      </div>
    );
  }

  // Pre-process: detect session changes for "joined conversation" banners
  let lastDate: Date | null = null;
  let lastSessionId: string | null = null;
  // Track which sessions already had their first from_me message
  const sessionsSeen = new Set<string>();

  const elements: React.ReactNode[] = [];

  messages.forEach((msg) => {
    const msgDate = new Date(msg.sent_at);

    // Date separator
    if (!lastDate || !isSameDay(lastDate, msgDate)) {
      elements.push(<DateSeparator key={`date-${msg.id}`} date={msgDate} />);
      lastDate = msgDate;
    }

    // Session join banner: only when from_me and session changes to a new one
    if (msg.from_me && msg.session_id && msg.session_id !== lastSessionId) {
      // Only show banner if this is NOT the first session (i.e., someone new joined)
      if (sessionsSeen.size > 0 && !sessionsSeen.has(msg.session_id)) {
        const joinName = msg.sender_name || msg.session_owner_name || msg.session_instance_name || 'Usuário';
        elements.push(
          <SessionJoinedBanner key={`join-${msg.id}`} userName={joinName} time={msg.sent_at} />
        );
      }
      sessionsSeen.add(msg.session_id);
      lastSessionId = msg.session_id;
    }

    elements.push(
      <MessageBubbleWrapper key={msg.id} msg={msg} leadName={leadName} leadId={leadId} />
    );
  });

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-0 px-2 py-3">
        {elements}
      </div>
    </ScrollArea>
  );
}
