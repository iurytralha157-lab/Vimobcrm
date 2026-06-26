import { notificationService } from '@/services/NotificationService';
import { leadsAPI } from '@/lib/api/leads';

interface NotifyLeadCreatedParams {
  leadId: string;
  leadName: string;
  organizationId: string;
  pipelineId?: string | null;
  assignedUserId?: string | null;
  source?: string;
}

/**
 * Notifica todas as partes interessadas quando um lead é criado:
 * 1. Vendedor atribuído (assigned_user_id)
 * 2. Líderes das equipes vinculadas à pipeline
 * 3. Administradores da organização
 *
 * Evita notificações duplicadas usando um Set de IDs já notificados.
 */
export async function notifyLeadCreated({
  leadId,
  leadName,
  organizationId,
  assignedUserId,
  source = 'manual',
}: NotifyLeadCreatedParams): Promise<void> {
  const notifications: {
    user_id: string;
    organization_id: string;
    lead_id: string;
    title: string;
    content: string;
    type: string;
  }[] = [];

  const sourceLabel = getSourceLabel(source);
  const leadContext = await getLeadNotificationContext(leadId, organizationId);

  // 1. Notificar o vendedor atribuído
  if (assignedUserId) {
    notifications.push({
      user_id: assignedUserId,
      organization_id: organizationId,
      lead_id: leadId,
      title: 'Novo lead recebido',
      content: `${leadName} foi atribuído a você (origem: ${sourceLabel})`,
      type: 'lead',
    });
  }

  for (const notification of notifications) {
    try {
      await notificationService.send({
        eventKey: 'new_lead_received',
        organizationId: notification.organization_id,
        userId: notification.user_id,
        leadId: notification.lead_id,
        variables: {
          lead_name: leadName,
          source: sourceLabel,
          campaign_name: leadContext.campaignName,
          lead_created_at: leadContext.createdAtLabel
        },
        dedupeKey: `new_lead_received:${notification.lead_id}:${notification.user_id}`,
      });
    } catch (error) {
      console.error('Erro ao disparar notificacao de novo lead para o responsavel:', error);
    }
  }

}

function getSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    manual: 'Manual',
    website: 'Site',
    whatsapp: 'WhatsApp',
    meta: 'Meta Ads',
    facebook: 'Facebook',
    instagram: 'Instagram',
    api: 'API',
    import: 'Importação',
  };
  return labels[source] || source;
}

async function getLeadNotificationContext(leadId: string, organizationId: string) {
  const fallback = {
    campaignName: 'Não informado',
    createdAtLabel: formatLeadNotificationDate(new Date()),
  };

  try {
    const { data: lead } = await leadsAPI.getLead(leadId, organizationId);
    const campaignName = lead.utm_campaign || fallback.campaignName;
    const createdAtLabel = lead.created_at
      ? formatLeadNotificationDate(new Date(lead.created_at))
      : fallback.createdAtLabel;

    return { campaignName, createdAtLabel };
  } catch (error) {
    console.error('Erro ao buscar contexto da notificacao de lead:', error);
    return fallback;
  }
}

function formatLeadNotificationDate(date: Date) {
  const datePart = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  }).format(date);

  const timePart = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Sao_Paulo',
  }).format(date);

  return `${datePart} | ${timePart}`;
}


interface NotifyLeadWonParams {
  leadId: string;
  leadName: string;
  organizationId: string;
  organizationName: string;
  assignedUserId?: string | null;
}

/**
 * Notifica sobre fechamento de negócio (Lead Ganho).
 */
export async function notifyLeadWon({
  leadId,
  leadName,
  organizationId,
  organizationName,
  assignedUserId,
}: NotifyLeadWonParams): Promise<void> {
  const notifiedUserIds = new Set<string>();

  // 1. Notificar o vendedor atribuído
  if (assignedUserId) {
    notifiedUserIds.add(assignedUserId);
  }

  // Disparar para todos os usuários identificados
  for (const userId of notifiedUserIds) {
    try {
      await notificationService.send({
        eventKey: 'deal_won',
        organizationId,
        userId,
        leadId,
        variables: {
          lead_name: leadName,
          organization_name: organizationName
        }
      });
    } catch (error) {
      console.error(`Erro ao disparar notificação de venda para usuário ${userId}:`, error);
    }
  }
}
