import type { HistoryMetadata, LeadHistoryFormatters } from './types';
import { metadataNumber, metadataString } from './metadata';


export function sourceLabel(source?: string | null): string | null {
  if (!source) return null;
  const labels: Record<string, string> = {
    meta: 'Meta Ads',
    meta_ads: 'Meta Ads',
    whatsapp: 'WhatsApp',
    webhook: 'Webhook',
    website: 'Site',
    site: 'Site',
    wordpress: 'WordPress',
    manual: 'Manual',
    indicacao: 'Indicação',
    portais: 'Portais',
    facebook: 'Facebook',
    instagram: 'Instagram',
    google: 'Google',
    google_ads: 'Google Ads',
    import: 'Importação',
    outros: 'Outros',
    outro: 'Outro',
  };
  return labels[source] || source;
}

// Types that only exist in activities (never in timeline) - no deduplication needed
export const ACTIVITY_ONLY_TYPES = new Set([
  'call',
  'email',
  'note',
  'message',
  'meta_form_answer',
  'webhook_form_answer',
  'meta_creative',
  'task_completed',
  'contact_updated',
  'automation_message',
  'commission_created',
  'commission_updated',
  'property_selected',
  'property_linked',
  'document_attached',
  'attachment_created',
  'proposal_sent',
  'agenda_created',
  'agenda_rescheduled',
  'agenda_completed',
  'agenda_cancelled',
  'visit_scheduled',
  'visit_made',
  'visit_confirmed',
  'meeting_scheduled',
  'meeting_made',
  'meeting_held',
]);

// Types where timeline is authoritative - skip activity duplicate
export const TIMELINE_AUTHORITY_TYPES = new Set([
  'lead_created',
  'lead_assigned',
  'assignee_changed', // deduplica com lead_assigned da timeline
  'stage_changed',
  'stage_change',
  'first_response',
  'whatsapp_message_sent',
  'whatsapp_message_received',
  'call_initiated',
  'note_created',
  'tag_added',
  'tag_removed',
  'sla_warning',
  'sla_overdue',
  'lead_reentry',
]);

export function buildLabel(type: string, metadata: HistoryMetadata): string {
  switch (type) {
    case 'lead_created': {
      const src = metadata?.source_label || metadata?.source;
      if (!src) return 'Lead criado';
      if (src === 'meta_ads' || src === 'Meta Ads') return 'Lead criado via Meta Ads';
      if (src === 'whatsapp' || src === 'WhatsApp') return 'Lead criado via WhatsApp';
      if (src === 'webhook' || src === 'Webhook' || src === 'generic_webhook') {
        const name = metadata?.form_name || metadata?.webhook_name;
        return name ? `Lead criado via "${name}"` : 'Lead criado via Webhook';
      }
      if (src === 'website' || src === 'Site') return 'Lead criado via Site';
      if (src === 'manual') return 'Lead criado manualmente';
      return `Lead criado via ${src}`;
    }
    case 'lead_assigned': {
      const queueName = metadata?.distribution_queue_name || metadata?.queue_name;
      const assignedName = metadata?.assigned_user_name;
      if (queueName && assignedName) return `Distribuído via "${queueName}" → ${assignedName}`;
      if (queueName) return `Distribuído via "${queueName}"`;
      if (metadata?.destination === 'admin_fallback') return 'Atribuído ao administrador (sem fila ativa)';
      if (metadata?.destination === 'pool') return 'Enviado para o Pool';
      if (assignedName) return `Atribuído a ${assignedName}`;
      return 'Distribuído';
    }
    case 'stage_changed':
    case 'stage_change': {
      const from = metadata?.old_stage_name || metadata?.from_stage;
      const to = metadata?.new_stage_name || metadata?.to_stage;
      if (!from || from === 'Desconhecido' || from === 'Unknown') {
        return `Iniciado no estágio ${to || 'Base'}`;
      }
      if (from && to) return `Movido: ${from} → ${to}`;
      return 'Estágio alterado';
    }
    case 'first_response':
      return 'Primeiro contato';
    case 'whatsapp_message_sent':
      return 'Mensagem enviada (WhatsApp)';
    case 'whatsapp_message_received':
      return 'Mensagem recebida (WhatsApp)';
    case 'call_initiated':
      return 'Ligação iniciada';
    case 'note_created':
    case 'note':
      return 'Nota adicionada';
    case 'tag_added':
      return metadata?.tag_name ? `Tag "${metadata.tag_name}" adicionada` : 'Tag adicionada';
    case 'tag_removed':
      return metadata?.tag_name ? `Tag "${metadata.tag_name}" removida` : 'Tag removida';
    case 'sla_warning':
      return 'SLA em alerta';
    case 'sla_overdue':
      return 'SLA estourado';
    case 'call':
      return 'Ligação realizada';
    case 'email':
      return 'Email enviado';
    case 'message':
      return 'Mensagem enviada';
    case 'property_selected':
    case 'property_linked': {
      const code = metadataString(metadata?.property_code) || metadataString(metadata?.property_ref);
      const title = metadataString(metadata?.property_title) || metadataString(metadata?.property_name);
      if (code && title) return `Imovel selecionado: ${code} - ${title}`;
      if (code || title) return `Imovel selecionado: ${code || title}`;
      return 'Imovel selecionado';
    }
    case 'document_attached':
    case 'attachment_created': {
      const fileName =
        metadataString(metadata?.file_name) ||
        metadataString(metadata?.fileName) ||
        metadataString(metadata?.filename) ||
        metadataString(metadata?.attachment_name);
      return fileName ? `Documento anexado: ${fileName}` : 'Documento anexado';
    }
    case 'meta_form_answer': {
      const question = metadataString(metadata?.question);
      return question ? `Meta: ${question}` : 'Resposta do formulário Meta';
    }
    case 'webhook_form_answer': {
      const question = metadataString(metadata?.question);
      return question ? `Webhook: ${question}` : 'Resposta do formulário';
    }
    case 'meta_creative':
      return 'Criativo Meta';
    case 'automation_message': {
      const ch = metadata?.channel || 'whatsapp';
      return `Mensagem automática (${ch === 'whatsapp' ? 'WhatsApp' : ch})`;
    }
    case 'task_completed':
      return 'Tarefa concluída';
    case 'contact_updated':
      return 'Contato atualizado';
    case 'assignee_changed': {
      if (metadata?.distribution_queue_name && metadata?.to_user_name) {
        const prefix = metadata?.is_initial_distribution === false ? 'Redistribuído' : 'Distribuído';
        return `${prefix} por "${metadata.distribution_queue_name}" → ${metadata.to_user_name}`;
      }
      const actorName = metadataString(metadata?.transferred_by_name);
      const targetName = metadataString(metadata?.to_user_name);
      if (!metadata?.to_user_id && !targetName) {
        return actorName ? `Responsável removido por ${actorName}` : 'Responsável removido';
      }
      if (actorName && targetName) return `Lead transferido por ${actorName} para ${targetName}`;
      if (targetName) return `Lead transferido para ${targetName}`;
      return 'Responsável alterado';
    }
    case 'lead_reentry': {
      if (metadata?.entry_type === 'manual_reentry') return 'Lead reentrou';
      if (metadata?.webhook_name) return `Lead reentrou via webhook "${metadata.webhook_name}"`;
      if (metadata?.source === 'whatsapp') return 'Lead reentrou via WhatsApp';
      return `Lead reentrou via ${metadata?.source || 'sistema'}`;
    }
    case 'status_change': {
      const from =
        metadataString(metadata?.from_status) ||
        metadataString(metadata?.previous_status) ||
        metadataString(metadata?.old_status);
      const to = metadataString(metadata?.to_status);
      const statusMap: Record<string, string> = { open: 'Aberto', won: 'Ganho', lost: 'Perdido' };
      if (from && to) return `Status: ${statusMap[from] || from} → ${statusMap[to] || to}`;
      return 'Status alterado';
    }
    case 'commission_created':
      return 'Comissão registrada';
    case 'commission_updated':
      return 'Comissão atualizada';
    case 'lead_updated':
      return 'Lead editado';
    case 'lead_deleted':
      return 'Lead excluido';
    case 'lead_auto_redistributed':
      return 'Redistribuicao automatica';
    case 'sale_closed':
      return 'Venda concluida';
    case 'property_interest_reserved':
      return 'Imovel reservado';
    case 'whatsapp':
      return 'Mensagem WhatsApp';
    case 'assignment':
      return metadata?.to_user_name ? `Atribuído a ${metadata.to_user_name}` : 'Lead atribuído';
    case 'automation_stage_move':
      return 'Movido por automação';
    case 'automation_tag_added':
      return 'Tag adicionada por automação';
    case 'proposal_sent':
      return 'Proposta registrada';
    case 'agenda_created':
      return 'Atividade agendada';
    case 'agenda_rescheduled':
      return 'Atividade remarcada';
    case 'agenda_completed':
      return 'Atividade concluida';
    case 'agenda_cancelled':
      return 'Atividade cancelada';
    case 'visit_scheduled':
      return 'Visita agendada';
    case 'visit_made':
    case 'visit_confirmed':
      return 'Visita realizada';
    case 'meeting_scheduled':
      return 'Reunião agendada';
    case 'meeting_made':
    case 'meeting_held':
      return 'Reunião realizada';
    default: {
      if (metadata?.is_automation) return `Ação automática (${type})`;
      const translations: Record<string, string> = {
        'call_made': 'Ligação realizada',
        'message_sent': 'Mensagem enviada',
        'contact_made': 'Contato realizado',
        'prospecting_report': 'Relatório de prospecção',
        'agenda_created': 'Atividade agendada',
        'agenda_rescheduled': 'Atividade remarcada',
        'agenda_completed': 'Atividade concluída',
        'agenda_cancelled': 'Atividade cancelada'
      };
      return translations[type] || type.replace(/_/g, ' ');
    }
  }
}

export function buildContent(
  type: string,
  metadata: HistoryMetadata,
  formatters: LeadHistoryFormatters,
): string | undefined {
  switch (type) {
    case 'first_response': {
      const secs = metadata?.response_seconds;
      if (secs !== undefined && secs !== null) {
        return `Primeiro contato: ${formatters.formatResponseTime(Number(secs))}`;
      }
      return undefined;
    }
    case 'stage_changed':
    case 'stage_change': {
      const from = metadataString(metadata?.old_stage_name) || metadataString(metadata?.from_stage);
      const to = metadataString(metadata?.new_stage_name) || metadataString(metadata?.to_stage);
      const isInitial = !from || from === 'Desconhecido' || from === 'Unknown';
      if (!isInitial && from && to) return `${from} → ${to}`;
      return undefined;
    }
    case 'property_selected':
    case 'property_linked': {
      const details = [
        metadataString(metadata?.property_title) || metadataString(metadata?.property_name),
        metadataString(metadata?.property_code) || metadataString(metadata?.property_ref),
      ].filter(Boolean);
      const price = metadataNumber(metadata?.property_price);
      if (price) details.push(formatters.formatCurrency(price));
      return details.join(' | ') || undefined;
    }
    case 'document_attached':
    case 'attachment_created':
      return metadataString(metadata?.file_name) || metadataString(metadata?.attachment_name) || undefined;
    case 'agenda_created':
    case 'agenda_rescheduled':
    case 'agenda_completed':
    case 'agenda_cancelled':
    case 'visit_scheduled':
    case 'visit_confirmed':
    case 'meeting_scheduled':
    case 'meeting_held': {
      const title = metadataString(metadata?.title) || metadataString(metadata?.event_title);
      const startsAt =
        metadataString(metadata?.starts_at) ||
        metadataString(metadata?.start_at) ||
        metadataString(metadata?.start_time) ||
        metadataString(metadata?.scheduled_at);
      return [title, startsAt].filter(Boolean).join(' | ') || undefined;
    }
    default:
      return undefined;
  }
}
