import type { UnifiedHistoryEvent } from '@/hooks/use-lead-history';

const FORM_ANSWER_TYPES = new Set(['meta_form_answer', 'webhook_form_answer']);

/** Form answers already projected by the lead history ("Meta: pergunta" → resposta). */
export function formAnswersFromHistory(events: UnifiedHistoryEvent[] | undefined) {
  return (events ?? [])
    .filter((event) => FORM_ANSWER_TYPES.has(event.type) && Boolean(event.content?.trim()))
    .map((event) => ({
      id: event.id,
      question: event.label.replace(/^(Meta|Webhook):\s*/i, '').trim() || 'Pergunta',
      answer: event.content!.trim(),
    }));
}

