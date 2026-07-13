"use client";

import { useMemo } from 'react';
import { Bot, Clock, History } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { type Property, usePropertyHistory } from '@/hooks/use-properties';
import { useUsers } from '@/hooks/use-users';

interface PropertyHistoryDialogProps {
  property: Property | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatHistoryDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function metadataString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function metadataBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'sim'].includes(value.toLowerCase());
  return false;
}

function getInitials(name?: string | null, email?: string | null) {
  const source = (name || email || '').trim();
  if (!source) return 'U';

  const parts = source
    .replace(/@.*/, '')
    .split(/\s+/)
    .filter(Boolean);

  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function metadataRecord(value: unknown) {
  return isRecord(value) ? value : {};
}

function changedTo(metadata: Record<string, unknown>, field: string) {
  const changes = metadataRecord(metadata.changes);
  const value = changes[field];

  if (isRecord(value) && 'to' in value) {
    return value.to;
  }

  return value;
}

function statusLabel(value: unknown) {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  const labels: Record<string, string> = {
    active: 'ativo',
    ativo: 'ativo',
    disponivel: 'ativo',
    available: 'ativo',
    reserved: 'reservado',
    reservado: 'reservado',
    sold: 'vendido',
    vendido: 'vendido',
    rented: 'alugado',
    alugado: 'alugado',
    locado: 'alugado',
    inactive: 'inativo',
    inativo: 'inativo',
  };

  return labels[normalized] || normalized;
}

function publicationLabel(value: unknown) {
  if (typeof value === 'boolean') return value ? 'público' : 'privado';
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'sim', 'yes', '1', 'publico', 'publicado'].includes(normalized)) return 'público';
    if (['false', 'nao', 'no', '0', 'privado'].includes(normalized)) return 'privado';
  }

  return null;
}

function propertyLabel(metadata: Record<string, unknown>, property: Property | null) {
  const code = metadataString(metadata.code) || metadataString(metadata.property_code) || property?.code;
  const title =
    metadataString(metadata.title) ||
    property?.title ||
    property?.tipo_de_imovel ||
    'imóvel';

  return [code, title].filter(Boolean).join(' - ');
}

function leadLabel(metadata: Record<string, unknown>) {
  return metadataString(metadata.lead_name) || metadataString(metadata.reserved_by_lead_name);
}

function historyAction(eventType: string, metadata: Record<string, unknown>, property: Property | null) {
  const label = propertyLabel(metadata, property);
  const status =
    statusLabel(changedTo(metadata, 'status')) ||
    statusLabel(metadataString(metadata.new_status)) ||
    statusLabel(metadataString(metadata.to_status));
  const publication =
    publicationLabel(changedTo(metadata, 'published_on_site')) ||
    publicationLabel(changedTo(metadata, 'anunciar'));

  if (eventType === 'property_created') {
    return { before: 'Criou o imóvel', property: label, after: '' };
  }

  if (eventType === 'property_status_changed') {
    return { before: 'Alterou o imóvel', property: label, after: status ? ` para ${status}` : '' };
  }

  if (eventType === 'property_publication_changed') {
    return { before: 'Alterou o imóvel', property: label, after: publication ? ` para ${publication}` : '' };
  }

  if (eventType === 'property_price_updated') {
    return { before: 'Atualizou o valor do imóvel', property: label, after: '' };
  }

  if (eventType === 'property_reserved_by_won_lead') {
    return { before: 'Reservou o imóvel', property: label, after: ' pelo ganho do lead', lead: leadLabel(metadata) };
  }

  if (eventType === 'property_schedule_completed') {
    return { before: 'Concluiu agendamento do imóvel', property: label, after: '' };
  }

  if (eventType === 'property_schedule') {
    return { before: 'Agendou compromisso no imóvel', property: label, after: '' };
  }

  return { before: 'Editou o imóvel', property: label, after: '' };
}

export function PropertyHistoryDialog({
  property,
  open,
  onOpenChange,
}: PropertyHistoryDialogProps) {
  const { data: historyEvents = [], isLoading } = usePropertyHistory(open ? property?.id ?? null : null);
  const { data: users = [] } = useUsers();
  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[78vh] max-h-[78vh] w-[min(720px,calc(100vw-2rem))] max-w-[720px] flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base font-medium">
            <History className="h-4 w-4 text-primary" />
            Histórico do imóvel
          </DialogTitle>
          {property && (
            <p className="truncate text-xs font-normal text-muted-foreground">
              {[property.code, property.title || property.tipo_de_imovel].filter(Boolean).join(' - ')}
            </p>
          )}
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 px-5 py-4">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="ml-11 h-16 rounded-[10px]" />
              <Skeleton className="ml-11 h-16 rounded-[10px]" />
              <Skeleton className="ml-11 h-16 rounded-[10px]" />
            </div>
          ) : historyEvents.length > 0 ? (
            <div className="space-y-3">
              {historyEvents.map((event) => {
                const message = metadataString(event.metadata?.message);
                const title = event.title || message || 'Atualização do imóvel';
                const action = historyAction(event.type, event.metadata, property);
                const actorId =
                  metadataString(event.metadata?.actor_user_id) ||
                  metadataString(event.metadata?.user_id) ||
                  metadataString(event.metadata?.created_by);
                const actor = actorId ? userMap.get(actorId) : null;
                const fallbackActorName = metadataString(event.metadata?.user_name);
                const actorName = actor?.name || actor?.email || fallbackActorName;
                const lowerTitle = title.toLowerCase();
                const lowerMessage = message?.toLowerCase() || '';
                const isAutomation =
                  metadataBoolean(event.metadata?.is_automation) ||
                  event.type.includes('automation') ||
                  event.type.includes('automatic') ||
                  lowerTitle.includes('automaticamente') ||
                  lowerMessage.includes('automaticamente');
                const displayActor = isAutomation ? null : actor;
                const actorLabel = isAutomation ? 'Automatico' : actorName || 'Sistema';

                return (
                  <article key={event.id} className="flex items-start justify-end gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="ml-auto max-w-[92%] rounded-[10px] rounded-tr-[4px] bg-[var(--app-surface-soft)] px-3 py-2.5">
                        <p className="mb-1 text-[11px] font-medium leading-none text-primary">{actorLabel}</p>
                        <p className="text-[13px] font-normal leading-snug text-foreground">
                          {action.before}{' '}
                          <span className="font-semibold text-primary">{action.property}</span>
                          {action.after}
                          {action.lead && (
                            <>
                              {' '}
                              <span className="font-semibold text-primary">{action.lead}</span>
                            </>
                          )}
                        </p>
                      </div>
                      <span className="ml-auto mt-1 flex max-w-[92%] justify-end gap-1 text-[11px] font-normal text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatHistoryDate(event.created_at)}
                      </span>
                    </div>

                    <Avatar className="mt-0.5 h-8 w-8 shrink-0 border-0">
                      {displayActor?.avatar_url && <AvatarImage src={displayActor.avatar_url} alt={actorLabel} />}
                      <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                        {displayActor ? getInitials(displayActor.name, displayActor.email) : <Bot className="h-4 w-4" />}
                      </AvatarFallback>
                    </Avatar>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg bg-[var(--app-surface-soft)] p-4 text-center text-sm font-normal text-muted-foreground">
              Nenhum historico registrado ainda.
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
