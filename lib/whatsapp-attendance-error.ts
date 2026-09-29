import { VimobAPIError } from '@/lib/api/vimob-error';

export function describeWhatsAppAttendanceFailure(error: unknown): string {
  if (!(error instanceof VimobAPIError)) {
    return 'Tente novamente. A mensagem continua no campo de texto.';
  }

  switch (error.code) {
    case 'whatsapp_session_not_found':
      return 'Esta conexão está indisponível para o seu usuário ou foi desconectada. Confira o WhatsApp e a atribuição deste lead.';
    case 'whatsapp_conversation_binding_changed':
    case 'whatsapp_conversation_not_found':
      return 'O vínculo desta conversa mudou. Atualize o atendimento antes de enviar.';
    case 'permission_denied':
    case 'whatsapp_feature_unavailable':
      return 'Seu usuário não tem permissão para enviar nesta conversa.';
    case 'api_timeout':
    case 'api_unavailable':
      return 'A confirmação não respondeu. Atualize o atendimento antes de tentar novamente; a mensagem continua no campo de texto.';
    default:
      return 'Não foi possível confirmar sua entrada. A mensagem continua no campo de texto.';
  }
}
