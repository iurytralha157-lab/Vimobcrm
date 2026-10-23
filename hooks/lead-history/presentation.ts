import type { HistoryMetadata, LeadHistoryFormatters } from './types';
import { metadataNumber, metadataString } from './metadata';
import { getAgendaHistoryPresentation } from './agenda-history';


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
  return Object.hasOwn(labels, source) ? labels[source] : source;
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
  'property_interests_changed',
  'document_attached',
  'attachment_created',
  'proposal_sent',
  'agenda_created',
  'agenda_rescheduled',
  'agenda_completed',
  'agenda_cancelled',
  'agenda_no_show',
  'agenda_commented',
  'agenda_updated',
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
  const agenda = getAgendaHistoryPresentation(type, metadata);
  if (agenda) return agenda.label;
  switch (type) {
    case 'lead_created': {
      const src = metadataString(metadata?.source_label) || metadataString(metadata?.source);
      if (!src) return 'Lead criado';
      if (src === 'meta_ads' || src === 'Meta Ads') return 'Lead criado via Meta Ads';
      if (src === 'whatsapp' || src === 'WhatsApp') return 'Lead criado via WhatsApp';
      if (src === 'webhook' || src === 'Webhook' || src === 'generic_webhook') {
        const name = metadataString(metadata?.form_name) || metadataString(metadata?.webhook_name);
        return name ? `Lead criado via "${name}"` : 'Lead criado via Webhook';
      }
      if (src === 'website' || src === 'Site') return 'Lead criado via Site';
      if (src === 'manual') return 'Lead criado manualmente';
      return `Lead criado via ${src}`;
    }
    case 'lead_assigned': {
      const queueName = metadataString(metadata?.distribution_queue_name) || metadataString(metadata?.queue_name);
      const assignedName = metadataString(metadata?.assigned_user_name);
      if (queueName && assignedName) return `Distribuído via "${queueName}" → ${assignedName}`;
      if (queueName) return `Distribuído via "${queueName}"`;
      if (metadata?.destination === 'admin_fallback') return 'Atribuído ao administrador (sem fila ativa)';
      if (metadata?.destination === 'pool') return 'Enviado para o Pool';
      if (assignedName) return `Atribuído a ${assignedName}`;
      return 'Distribuído';
    }
    case 'stage_changed':
    case 'stage_change': {
      const from = metadataString(metadata?.old_stage_name) || metadataString(metadata?.from_stage);
      const to = metadataString(metadata?.new_stage_name) || metadataString(metadata?.to_stage);
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
    case 'tag_added': {
      const name = metadataString(metadata?.tag_name);
      return name ? `Tag "${name}" adicionada` : 'Tag adicionada';
    }
    case 'tag_removed': {
      const name = metadataString(metadata?.tag_name);
      return name ? `Tag "${name}" removida` : 'Tag removida';
    }
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
    case 'property_interests_changed':
      return 'Imóveis de interesse atualizados';
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
      const ch = metadataString(metadata?.channel) || 'whatsapp';
      return `Mensagem automática (${ch === 'whatsapp' ? 'WhatsApp' : ch})`;
    }
    case 'task_completed':
      return 'Tarefa concluída';
    case 'contact_updated':
      return 'Contato atualizado';
    case 'assignee_changed': {
      const queueName = metadataString(metadata?.distribution_queue_name);
      const targetName = metadataString(metadata?.to_user_name);
      if (queueName && targetName) {
        const prefix = metadata?.is_initial_distribution === false ? 'Redistribuído' : 'Distribuído';
        return `${prefix} por "${queueName}" → ${targetName}`;
      }
      const actorName = metadataString(metadata?.transferred_by_name);
      if (!metadata?.to_user_id && !targetName) {
        return actorName ? `Responsável removido por ${actorName}` : 'Responsável removido';
      }
      if (actorName && targetName) return `Lead transferido por ${actorName} para ${targetName}`;
      if (targetName) return `Lead transferido para ${targetName}`;
      return 'Responsável alterado';
    }
    case 'lead_reentry': {
      if (metadata?.entry_type === 'manual_reentry') return 'Lead reentrou';
      const webhookName = metadataString(metadata?.webhook_name);
      if (webhookName) return `Lead reentrou via webhook "${webhookName}"`;
      if (metadata?.source === 'whatsapp') return 'Lead reentrou via WhatsApp';
      return `Lead reentrou via ${sourceLabel(metadataString(metadata?.source)) || 'sistema'}`;
    }
    case 'status_change': {
      const from =
        metadataString(metadata?.from_status) ||
        metadataString(metadata?.previous_status) ||
        metadataString(metadata?.old_status);
      const to = metadataString(metadata?.to_status);
      const statusMap: Record<string, string> = { open: 'Aberto', won: 'Ganho', lost: 'Perdido' };
      const statusName = (value: string) => Object.hasOwn(statusMap, value) ? statusMap[value] : value;
      if (from && to) return `Status: ${statusName(from)} → ${statusName(to)}`;
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
    case 'assignment': {
      const targetName = metadataString(metadata?.to_user_name);
      return targetName ? `Atribuído a ${targetName}` : 'Lead atribuído';
    }
    case 'automation_stage_move':
      return 'Movido por automação';
    case 'automation_tag_added':
      return 'Tag adicionada por automação';
    case 'proposal_sent':
      return 'Proposta registrada';
    default: {
      if (metadata?.is_automation) return 'Ação automática registrada';
      const translations: Record<string, string> = {
        'call_made': 'Ligação realizada',
        'message_sent': 'Mensagem enviada',
        'contact_made': 'Contato realizado',
        'prospecting_report': 'Relatório de prospecção',
        'message_received': 'Mensagem recebida',
        'assignment_changed': 'Responsável alterado',
        'lead_stage_changed': 'Etapa alterada',
        'lost_lead_recovered': 'Lead recuperado',
      };
      return Object.hasOwn(translations, type) ? translations[type] : 'Atividade registrada';
    }
  }
}

export function buildContent(
  type: string,
  metadata: HistoryMetadata,
  formatters: LeadHistoryFormatters,
): string | undefined {
  const agenda = getAgendaHistoryPresentation(type, metadata, { timeZone: formatters.timeZone });
  if (agenda) return agenda.content;
  switch (type) {
    case 'first_response': {
      const secs = metadataNumber(metadata?.response_seconds);
      if (secs !== null) {
        return `${metadata?.is_automation ? 'Resposta automática' : 'Primeiro contato'}: ${formatters.formatResponseTime(secs)}`;
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
    case 'property_interests_changed': {
      const added = metadataNumber(metadata?.added_count);
      const removed = metadataNumber(metadata?.removed_count);
      const current = metadataNumber(metadata?.current_count);
      const counts = [
        added !== null && Number.isInteger(added) && added > 0 ? `${added} ${added === 1 ? 'imóvel adicionado' : 'imóveis adicionados'}` : null,
        removed !== null && Number.isInteger(removed) && removed > 0 ? `${removed} ${removed === 1 ? 'imóvel removido' : 'imóveis removidos'}` : null,
        current !== null && Number.isInteger(current) && current >= 0 ? `Total: ${current}` : null,
      ];
      return counts.filter(Boolean).join(' · ') || undefined;
    }
    case 'document_attached':
    case 'attachment_created':
      return metadataString(metadata?.file_name) || metadataString(metadata?.attachment_name) || undefined;
    default:
      return undefined;
  }
}
