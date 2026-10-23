import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compactPresentation, metadataAlignment, contextChips, hideOnFullPage, olderFailureRetry, incrementalPagination, navigationPresentation, greyNavigation, memoizedBubble } from "./floating-chat-ui-cases.mjs";
import { inboxScopeAndWriteGate, permissionFailClosed, waitForSessions, leadTagIsolation, syncActiveMetadata, localizedRetries, mediaRecovery, accessibleKeyboard } from "./floating-chat-action-cases.mjs";
import { scopedDraftsAndRollback, viewportAndCleanup } from "./floating-chat-hook-cases.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

const floatingChatSource = readRepoFile(
  "components/features/chat/FloatingChat.tsx",
);
const floatingChatButtonSource = readRepoFile(
  "components/features/chat/FloatingChatButton.tsx",
);
const conversationListItemSource = readRepoFile(
  "components/features/whatsapp/conversations/ConversationListItem.tsx",
);
const conversationListSource = readRepoFile(
  "components/features/whatsapp/conversations/ConversationList.tsx",
);
const conversationListPositionSource = readRepoFile(
  "components/features/whatsapp/conversations/conversation-list-position.ts",
);
const conversationMessagesSource = readRepoFile(
  "components/features/whatsapp/conversations/ConversationMessages.tsx",
);
const conversationsScreenSource = readRepoFile(
  "components/features/whatsapp/ConversationsScreen.tsx",
);
const floatingChatContextSource = readRepoFile(
  "contexts/FloatingChatContext.tsx",
);
const onlineUsersPanelSource = readRepoFile(
  "components/features/presence/OnlineUsersPanel.tsx",
);
const whatsappConversationsHookSource = readRepoFile(
  "hooks/use-whatsapp-conversations.ts",
);
const whatsappApiSource = readRepoFile(
  "lib/api/whatsapp.ts",
);

function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `inicio do contrato ausente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `fim do contrato ausente: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("balão usa o mesmo escopo Todos da página e sincroniza somente quando visível", () => {
  assert.match(
    floatingChatSource,
    /useState<string>\("all"\)/,
  );
  assert.match(
    floatingChatSource,
    /resolveWhatsAppConversationSessionFilter\(/,
  );
  assert.match(
    floatingChatSource,
    /conversationSessionFilter\.accessibleSessionIds/,
  );
  assert.match(floatingChatSource, /const shouldSyncFloatingChat = chatVisible/);
  assert.match(floatingChatSource, /enabled: shouldSyncFloatingChat/);
  assert.match(
    floatingChatSource,
    /<SelectItem value="all">Todas as contas<\/SelectItem>/,
  );
  assert.doesNotMatch(
    floatingChatSource,
    /if \(!selectedSessionId && sessions\?\.length\)/,
  );

  assert.match(
    floatingChatButtonSource,
    /shouldQueryFloatingChatData \? undefined : \[\]/,
  );
  assert.match(floatingChatButtonSource, /\{ enabled: shouldQueryFloatingChatData \}/);
  assert.doesNotMatch(
    floatingChatButtonSource,
    /useAccessibleSessions/,
  );
});

test("balão aberto recebe o sinal privado do inbox sem habilitar envio sem lead", inboxScopeAndWriteGate);

test("balão diferencia falha, filtro vazio e histórico sem sessão conectada", () => {
  assert.match(
    floatingChatSource,
    /Não foi possível atualizar o WhatsApp/,
  );
  assert.match(
    floatingChatSource,
    /Nenhuma conversa com estes filtros/,
  );
  assert.match(
    floatingChatSource,
    /!hasWhatsAppAccess && !conversations\?\.length/,
  );
});

test("cabeçalho, busca e launcher mantêm densidade compacta e elevação neutra", compactPresentation);

test("balão reutiliza o item completo de Conversas sem cobrir horário e contador", () => {
  assert.match(floatingChatSource, /<ConversationListItem/);
  assert.match(floatingChatSource, /onArchive=\{\(\) => handleArchiveConversation\(conversation\)\}/);
  assert.match(floatingChatSource, /onDelete=\{\(\) => handleDeleteConversation\(conversation\)\}/);
  assert.match(floatingChatSource, /onAddTag=\{\(tagId\)/);
  assert.match(floatingChatSource, /onRemoveTag=\{\(tagId\)/);
  assert.doesNotMatch(floatingChatSource, /absolute right-2 top-1\/2/);

  assert.match(conversationListItemSource, /grid-cols-\[minmax\(0,1fr\)_auto_auto\]/);
  assert.match(conversationListItemSource, /Mais ações de/);
  assert.match(conversationListItemSource, />\s*Tag\s*</);
  assert.match(conversationListItemSource, /Arquivar/);
  assert.match(conversationListItemSource, /Remover/);
});

test("tags ficam em uma linha com uma etiqueta visível e indicador +N", () => {
  assert.match(
    conversationListItemSource,
    /data-conversation-tags[\s\S]{0,180}flex-nowrap[\s\S]{0,120}overflow-hidden/,
  );
  assert.match(conversationListItemSource, /leadTags\.slice\(0, 1\)/);
  assert.match(conversationListItemSource, /\+\{leadTags\.length - 1\}/);
  assert.match(conversationListItemSource, /aria-label=\{`Ver mais \$\{leadTags\.length - 1\} tags`\}/);
  assert.match(conversationListItemSource, /getTagColorStyleWithWhiteText\(leadTag\.tag\.color\)/);
});

test("metadados da lista não cobrem conteúdo e horários ficam no rodapé do balão", metadataAlignment);

test("contexto da conversa aberta mantém chips compactos e as cores atuais de tags, etapa e funil", contextChips);

test("balão não permanece vazio sobre a página completa de Conversas", hideOnFullPage);

test("minimizar foi removido do estado e das superfícies que compartilham o balão", () => {
  const floatingSurfaceSource = [
    floatingChatSource,
    floatingChatButtonSource,
    floatingChatContextSource,
    onlineUsersPanelSource,
  ].join("\n");

  assert.doesNotMatch(
    floatingSurfaceSource,
    /\b(?:isMinimized|minimizeChat|maximizeChat|Minimize2)\b/,
  );
  assert.match(floatingChatContextSource, /isOpen: boolean/);
  assert.match(floatingChatContextSource, /isPresenceOpen: boolean/);
});

test("launcher aparece sem atraso fixo e consulta somente o contador leve", () => {
  assert.match(floatingChatButtonSource, /useWhatsAppUnreadCount/);
  assert.doesNotMatch(floatingChatButtonSource, /\buseWhatsAppConversations\b/);
  assert.doesNotMatch(
    floatingChatButtonSource,
    /\b(?:LAUNCHER_DELAY_MS|isLauncherReady|launcherTimer|setTimeout)\b/,
  );
  assert.match(floatingChatButtonSource, /modulesLoading[\s\S]{0,160}permissionsLoading[\s\S]{0,160}canViewWhatsApp/);

  assert.match(whatsappConversationsHookSource, /whatsappQueryKeys\.unreadCount/);
  assert.match(whatsappConversationsHookSource, /whatsappAPI\.getUnreadCount\(/);
  assert.match(whatsappApiSource, /\/v1\/whatsapp\/conversations\/unread-count/);
  assert.doesNotMatch(
    sourceBetween(whatsappApiSource, "async getUnreadCount", "async startConversation"),
    /getConversationsPage|getConversations\(/,
  );
});

test("operações do balão falham fechadas sem whatsapp_operate", permissionFailClosed);

test("reações ficam indisponíveis até a mensagem possuir alvo canônico", () => {
  assert.match(
    floatingChatSource,
    /Boolean\(item\.message\.session_id\)[\s\S]{0,100}canReactToWhatsAppMessage\(item\.message\)/,
  );
  assert.match(
    conversationMessagesSource,
    /Boolean\(item\.message\.session_id\)[\s\S]{0,100}canReactToWhatsAppMessage\(item\.message\)/,
  );
  assert.match(
    whatsappConversationsHookSource,
    /mutationFn: async \(variables: ReactToWhatsAppMessageVariables\)[\s\S]{0,320}if \(!canReactToWhatsAppMessage\(variables\.targetMessage\)\)/,
  );
  assert.match(
    whatsappConversationsHookSource,
    /onMutate: async \(variables\)[\s\S]{0,320}if \(!canReactToWhatsAppMessage\(variables\.targetMessage\)\)/,
  );
  assert.match(
    whatsappConversationsHookSource,
    /WHATSAPP_MESSAGE_NOT_READY_FOR_REACTION/,
  );
  assert.match(
    floatingChatSource,
    /isReacting=\{reactToMessage\.isPending[\s\S]{0,120}reactToMessage\.variables\?\.targetMessage\.id === item\.message\.id\}/,
  );
  assert.match(
    conversationMessagesSource,
    /isReacting=\{reactingMessageId === item\.message\.id\}/,
  );
});

test("nova conversa aguarda o cache de sessões antes de consumir o estado pendente", waitForSessions);

test("tags exigem lead_operate sem liberar ações gerais do WhatsApp", leadTagIsolation);

test("falha ao carregar histórico antigo mantém mensagens e oferece retry localizado", olderFailureRetry);

test("conversa ativa recebe todos os metadados novos da lista sem loop de estado", syncActiveMetadata);

test("falha ao buscar tags aparece no submenu e pode ser tentada novamente", () => {
  assert.match(floatingChatSource, /isError: tagsFailed/);
  assert.match(floatingChatSource, /refetch: refetchTags/);
  assert.match(floatingChatSource, /isTagsError=\{tagsFailed\}/);
  assert.match(floatingChatSource, /onRetryTags=\{\(\) => void refetchTags\(\)\}/);
  assert.match(conversationListItemSource, /isTagsError && availableTags\.length === 0/);
  assert.match(conversationListItemSource, /Não foi possível carregar as tags/);
  assert.match(conversationListItemSource, /onRetryTags\(\)/);
});

test("rascunhos são isolados por tenant, conversa e card e voltam ao snapshot original quando o envio falha", scopedDraftsAndRollback);

test("falhas de sessões, conversas e mensagens oferecem uma nova tentativa real", localizedRetries);

test("recuperação de mídia chama o backend e reconcilia a conversa", mediaRecovery);

test("scroll lê o viewport real e todo agendamento visual tem cancelamento", viewportAndCleanup);

test("Escape, IME e nomes acessíveis preservam teclado e leitores de tela", accessibleKeyboard);

test("histórico e lista expõem paginação incremental com estado de carregamento", incrementalPagination);

test("histórico destaca a paginação antiga e oferece retorno às mensagens recentes", navigationPresentation);

test("lista restaura o mesmo contato e as páginas já mantidas no cache ao voltar", () => {
  assert.match(conversationListItemSource, /data-conversation-id=\{conversation\.id\}/);
  assert.match(conversationListPositionSource, /position\.key !== key/);
  assert.match(conversationListPositionSource, /viewport\.scrollTop = position\.scrollTop/);
  assert.match(conversationListPositionSource, /currentOffset - position\.anchorOffset/);

  assert.match(floatingChatSource, /captureConversationListReturnPosition\(/);
  assert.match(floatingChatSource, /restoreConversationListReturnPosition\(/);
  assert.match(floatingChatSource, /conversationListPositionKey/);

  assert.match(conversationListSource, /captureConversationListReturnPosition\(/);
  assert.match(conversationListSource, /restoreConversationListReturnPosition\(/);
  assert.match(conversationsScreenSource, /returnPositionKey=\{mobileConversationListPositionKey\}/);
  assert.match(conversationsScreenSource, /returnPosition=\{mobileConversationListReturnPosition\}/);
});

test("Voltar e Fechar têm fundo cinza permanente na conversa aberta", greyNavigation);

test("MessageBubble é memoizado por conteúdo sem rerender global por callbacks", memoizedBubble);
