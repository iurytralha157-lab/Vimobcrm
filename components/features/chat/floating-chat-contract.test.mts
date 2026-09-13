import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
const messageBubbleSource = readRepoFile(
  "components/features/whatsapp/MessageBubble.tsx",
);
const messageReactionSource = readRepoFile(
  "components/features/whatsapp/message-bubble/MessageReactions.tsx",
);
const messageTextSource = readRepoFile(
  "components/features/whatsapp/message-bubble/MessageText.tsx",
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
const userPermissionsHookSource = readRepoFile(
  "hooks/use-user-permissions.ts",
);
const whatsappApiSource = readRepoFile(
  "lib/api/whatsapp.ts",
);
const messageMediaSource = readRepoFile(
  "components/features/whatsapp/message-bubble/MessageMedia.tsx",
);
const messageAudioPlayerSource = readRepoFile(
  "components/features/whatsapp/message-bubble/MessageAudioPlayer.tsx",
);

function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `inicio do contrato ausente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `fim do contrato ausente: ${end}`);
  return source.slice(startIndex, endIndex);
}

function assertInOrder(source: string, markers: string[]) {
  let previousIndex = -1;
  for (const marker of markers) {
    const currentIndex = source.indexOf(marker, previousIndex + 1);
    assert.ok(currentIndex > previousIndex, `marcador fora de ordem ou ausente: ${marker}`);
    previousIndex = currentIndex;
  }
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

test("cabeçalho, busca e launcher mantêm densidade compacta e elevação neutra", () => {
  assert.match(
    floatingChatSource,
    /h-12 bg-primary px-3\.5 text-primary-foreground shadow-\[0_2px_8px_rgba\(0,0,0,0\.08\)\]/,
  );
  assert.doesNotMatch(floatingChatSource, /shadow-\[[^\]]*rgba\(255,69,41,/);
  assert.match(
    floatingChatSource,
    /aria-label="Buscar conversas"[\s\S]{0,360}text-\[11px\][\s\S]{0,220}md:text-\[11px\]/,
  );
  assert.match(
    floatingChatSource,
    /shadow-\[0_12px_32px_rgba\(0,0,0,0\.10\)\]/,
  );
  assert.match(
    floatingChatSource,
    /text-\[11px\].*\[&_svg\]:size-3\.5/,
  );

  assert.match(
    floatingChatButtonSource,
    /relative h-14 w-14.*rounded-full.*bg-primary.*shadow-\[/,
  );
  assert.match(floatingChatButtonSource, /<MessageCircle aria-hidden="true" className="h-7 w-7"/);
  assert.match(
    floatingChatButtonSource,
    /h-\[26px\] min-w-\[26px\].*text-\[12px\]/,
  );
  assert.doesNotMatch(
    floatingChatButtonSource,
    /bg-primary\/50/,
  );
});

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

test("metadados da lista não cobrem conteúdo e horários ficam no rodapé do balão", () => {
  assert.match(
    conversationListItemSource,
    /col-start-2 row-span-2 row-start-1[^"]*self-stretch[^"]*justify-center/,
  );
  assert.match(
    conversationListItemSource,
    /data-conversation-tags[\s\S]{0,180}col-end-2/,
  );
  assert.match(
    conversationListItemSource,
    /Mais ações de[\s\S]{0,240}row-span-2[^"]*self-center/,
  );

  assert.match(messageBubbleSource, /data-message-metadata/);
  assert.match(
    messageBubbleSource,
    /data-message-metadata[\s\S]{0,180}items-end/,
  );
  assert.doesNotMatch(
    messageBubbleSource,
    /data-message-metadata[\s\S]{0,180}justify-center/,
  );
  assert.match(
    messageBubbleSource,
    /data-message-timestamp-position="bottom-left"[\s\S]{0,100}mr-auto/,
  );
  assert.match(
    messageBubbleSource,
    /data-message-timestamp-position="bottom-right"[\s\S]{0,100}ml-auto/,
  );
  assert.match(
    messageMediaSource,
    /data-message-timestamp-position=\{fromMe \? "bottom-left" : "bottom-right"\}/,
  );
  assert.match(messageMediaSource, /fromMe \? "left-1" : "right-1"/);
  assert.doesNotMatch(messageMediaSource, /absolute bottom-1 right-1/);
  assert.match(
    messageAudioPlayerSource,
    /data-message-timestamp-position=\{fromMe \? "bottom-left" : "bottom-right"\}/,
  );
  assert.doesNotMatch(messageBubbleSource, /float-right/);
  assert.doesNotMatch(messageTextSource, /w-\[65px\]/);
  assert.doesNotMatch(messageReactionSource, /-(?:left|right)-9/);
  assert.match(messageReactionSource, /relative z-20 inline-flex shrink-0/);
});

test("contexto da conversa aberta usa chips sólidos, sem borda e com texto branco", () => {
  assert.match(floatingChatSource, /data-floating-chat-context/);
  assert.match(
    floatingChatSource,
    /contextChipClassName = "min-h-\[18px\].*max-w-full.*whitespace-normal.*\[overflow-wrap:anywhere\].*rounded-\[6px\].*border-0.*px-2.*font-semibold.*text-white/,
  );
  assert.match(
    floatingChatSource,
    /data-floating-chat-context className="[^"]*flex-wrap[^"]*gap-1\.5[^"]*px-3[^"]*pb-2\.5[^"]*pt-0\.5/,
  );
  assert.doesNotMatch(
    floatingChatSource,
    /data-floating-chat-context className="[^"]*(?:flex-nowrap|overflow-hidden)/,
  );
  assert.doesNotMatch(
    floatingChatSource,
    /cn\(contextChipClassName, "[^"]*(?:truncate|max-w-\[112px\])/,
  );
  assert.match(floatingChatSource, /max-w-full flex-wrap items-center gap-1\.5 text-muted-foreground/);
  assert.match(floatingChatSource, /getTagColorStyleWithWhiteText\(lt\.tag\.color\)/);
  assert.match(floatingChatSource, /getTagColorStyleWithWhiteText\(stageColor\)/);
  assert.match(floatingChatSource, /cn\(contextChipClassName, "[^"]*bg-primary/);
  assert.doesNotMatch(floatingChatSource, /\$\{lt\.tag\.color\}20/);
  assert.doesNotMatch(floatingChatSource, /borderColor: lt\.tag\.color/);
});

test("balão não permanece vazio sobre a página completa de Conversas", () => {
  assert.match(
    floatingChatSource,
    /const chatVisible = isOpen[\s\S]{0,180}&& canViewWhatsApp[\s\S]{0,80}&& !isPresenceOpen[\s\S]{0,80}&& pathname !== "\/crm\/conversas"/,
  );
  assert.match(floatingChatSource, /const shouldSyncFloatingChat = chatVisible/);
  assert.match(floatingChatSource, /refetchOnWindowFocus: true/);
});

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

test("operações do balão falham fechadas sem whatsapp_operate", () => {
  assert.match(
    floatingChatSource,
    /const canOperateWhatsApp = hasPermission\("whatsapp_operate"\)/,
  );
  assert.match(userPermissionsHookSource, /if \(isLoading\) return false/);
  assert.match(
    floatingChatSource,
    /if \(canOperateWhatsApp && activeConversationReadTarget && activeConversationReadTarget\.unreadCount > 0\)/,
  );
  assert.match(floatingChatSource, /const handleArchiveConversation[\s\S]{0,180}if \(!canOperateWhatsApp\) return/);
  assert.match(floatingChatSource, /const handleDeleteConversation[\s\S]{0,180}if \(!canOperateWhatsApp\) return/);
  assert.match(floatingChatSource, /const retryMediaDownload[\s\S]{0,180}if \(!canOperateWhatsApp\) return/);
  assert.match(floatingChatSource, /const handleSendMessage[\s\S]{0,220}if \(!canOperateWhatsApp/);
  assert.match(floatingChatSource, /const handleSendAudio[\s\S]{0,180}if \(!canOperateWhatsApp/);
  assert.match(floatingChatSource, /const isReadOnlyMode = !canOperateWhatsApp/);
  assert.match(floatingChatSource, /const messageInputDisabled = isReadOnlyMode \|\| whatsappMessageInputState\.disabled/);
  assert.match(floatingChatSource, /disabled=\{messageInputDisabled\}/);
  assert.match(
    floatingChatSource,
    /onReact=\{canOperateWhatsApp[\s\S]{0,180}Boolean\(activeConversation\?\.session_id\)[\s\S]{0,180}Boolean\(msg\.session_id\)/,
  );
  assert.match(floatingChatSource, /onRetryMedia=\{canOperateWhatsApp \?/);
});

test("reações ficam indisponíveis até a mensagem possuir alvo canônico", () => {
  assert.match(
    floatingChatSource,
    /Boolean\(msg\.session_id\)[\s\S]{0,100}canReactToWhatsAppMessage\(msg\)/,
  );
  assert.match(
    conversationMessagesSource,
    /Boolean\(message\.session_id\)[\s\S]{0,100}canReactToWhatsAppMessage\(message\)/,
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
    /isReacting=\{reactToMessage\.isPending[\s\S]{0,120}reactToMessage\.variables\?\.targetMessage\.id === msg\.id\}/,
  );
  assert.match(
    conversationMessagesSource,
    /isReacting=\{reactingMessageId === message\.id\}/,
  );
});

test("nova conversa aguarda o cache de sessões antes de consumir o estado pendente", () => {
  const pendingConversationSource = sourceBetween(
    floatingChatSource,
    "if (!pendingPhone) {",
    "if (!chatVisible || !activeConversationId) {",
  );

  assertInOrder(pendingConversationSource, [
    "if (!pendingPhone) {",
    "if (loadingSessions",
    "const connectedSessionKey",
    "pendingStartKeyRef.current = pendingStartKey",
    "openPendingConversation()",
  ]);
  assert.match(
    pendingConversationSource,
    /if \(loadingSessions[^)]*\) return/,
  );
  assert.match(
    pendingConversationSource,
    /\[\s*pendingPhone,\s*pendingLeadName,\s*pendingLeadId,\s*sessions,\s*loadingSessions,\s*accessReady,\s*canViewWhatsApp,\s*handleStartConversationWithSession,\s*\]/,
  );
});

test("tags exigem lead_operate sem liberar ações gerais do WhatsApp", () => {
  assert.match(conversationListItemSource, /canManageTags\?: boolean/);
  assert.match(conversationListItemSource, /canManageTags = canOperate/);
  assert.match(
    conversationListItemSource,
    /const canManageConversationTags = canManageTags && Boolean\(conversation\.lead\)/,
  );
  assert.match(conversationListItemSource, /\{canManageConversationTags && conversation\.lead && \(/);
  assert.match(floatingChatSource, /canManageTags=\{canOperateLeads\}/);
  assert.match(
    floatingChatSource,
    /onAddTag=\{\(tagId\) => canOperateLeads && conversation\.lead && addLeadTag\.mutate/,
  );
  assert.match(
    floatingChatSource,
    /onRemoveTag=\{\(tagId\) => canOperateLeads && conversation\.lead && removeLeadTag\.mutate/,
  );
  assert.match(floatingChatSource, /canOperate=\{canOperateWhatsApp\}/);
});

test("falha ao carregar histórico antigo mantém mensagens e oferece retry localizado", () => {
  assert.match(floatingChatSource, /isFetchNextPageError: olderMessagesFailed/);
  assert.match(floatingChatSource, /Tentar carregar mensagens anteriores/);
  assert.match(floatingChatSource, /O histórico atual foi mantido/);
  assert.match(
    floatingChatSource,
    /messagesFailed && \(messages\?\.length \?\? 0\) === 0/,
  );
  assert.match(
    floatingChatSource,
    /onClick=\{\(\) => void loadOlderMessages\(\)\}/,
  );
});

test("conversa ativa recebe todos os metadados novos da lista sem loop de estado", () => {
  const activeConversationSyncSource = sourceBetween(
    floatingChatSource,
    "if (!activeConversationId || !activeConversation || !conversations) return",
    "const handleScrollArea",
  );

  assert.match(
    activeConversationSyncSource,
    /conversations\.find\(\(conversation\) => conversation\.id === activeConversationId\)/,
  );
  assert.match(activeConversationSyncSource, /updatedConv && updatedConv !== activeConversation/);
  assert.match(activeConversationSyncSource, /openConversation\(updatedConv\)/);
  assert.match(
    activeConversationSyncSource,
    /\[activeConversation, activeConversationId, conversations, openConversation\]/,
  );
});

test("falha ao buscar tags aparece no submenu e pode ser tentada novamente", () => {
  assert.match(floatingChatSource, /isError: tagsFailed/);
  assert.match(floatingChatSource, /refetch: refetchTags/);
  assert.match(floatingChatSource, /isTagsError=\{tagsFailed\}/);
  assert.match(floatingChatSource, /onRetryTags=\{\(\) => void refetchTags\(\)\}/);
  assert.match(conversationListItemSource, /isTagsError && availableTags\.length === 0/);
  assert.match(conversationListItemSource, /Não foi possível carregar as tags/);
  assert.match(conversationListItemSource, /onRetryTags\(\)/);
});

test("rascunhos são isolados por conversa e voltam ao campo quando o envio falha", () => {
  assert.match(floatingChatSource, /useState<Record<string, string>>\(\{\}\)/);
  assert.match(
    floatingChatSource,
    /activeConversationId \? messageDrafts\[activeConversationId\] \?\? "" : ""/,
  );
  assert.match(floatingChatSource, /currentDrafts\[activeConversationId\] \?\? ""/);
  assert.match(floatingChatSource, /return \{ \.\.\.currentDrafts, \[activeConversationId\]: nextValue \}/);

  const sendMessageSource = sourceBetween(
    floatingChatSource,
    "const handleSendMessage = async",
    "const handleKeyPress",
  );
  assertInOrder(sendMessageSource, [
    "const textToSend = messageText.trim()",
    'setMessageText("")',
    "await sendMessage.mutateAsync",
    "catch (error)",
    'getWhatsAppSendFailureStatus(error) !== "confirming"',
    "setMessageText((current) => current || textToSend)",
  ]);
});

test("falhas de sessões, conversas e mensagens oferecem uma nova tentativa real", () => {
  assert.match(floatingChatSource, /sessionsFailed/);
  assert.match(floatingChatSource, /conversationsFailed/);
  assert.match(floatingChatSource, /Não foi possível atualizar o WhatsApp/);
  assert.match(
    floatingChatSource,
    /Promise\.all\(\[refetchSessions\(\), refetchConversations\(\)\]\)/,
  );

  assert.match(floatingChatSource, /messagesFailed/);
  assert.match(floatingChatSource, /Não foi possível carregar as mensagens/);
  assert.match(floatingChatSource, /onClick=\{\(\) => void refetchMessages\(\)\}/);
  assert.ok((floatingChatSource.match(/role="alert"/g) || []).length >= 2);
});

test("recuperação de mídia chama o backend e reconcilia a conversa", () => {
  const floatingRetrySource = sourceBetween(
    floatingChatSource,
    "const retryMediaDownload = async",
    "const handleSendMessage",
  );
  assertInOrder(floatingRetrySource, [
    "if (!canOperateWhatsApp) return",
    "await whatsappAPI.retryMediaDownload",
    "await refetchMessages()",
  ]);
  assert.match(
    whatsappApiSource,
    /\/v1\/whatsapp\/messages\/\$\{messageId\}\/retry-media[\s\S]{0,180}method: 'POST'/,
  );

  const manualMediaRetrySource = sourceBetween(
    messageMediaSource,
    "const handleManualMediaDownload = async",
    "const renderMediaPolicyPlaceholder",
  );
  assert.match(manualMediaRetrySource, /await onRetryMedia\(\)/);
  assert.match(messageAudioPlayerSource, /const retryAudio = async[\s\S]{0,260}await onRetryMedia\(\)/);

  const retryImageSource = sourceBetween(messageMediaSource, "const retryImage", "const retryVideo");
  const retryVideoSource = sourceBetween(messageMediaSource, "const retryVideo", "const handleDownloadMedia");
  assert.match(retryImageSource, /async[\s\S]{0,500}await (?:onRetryMedia|handleManualMediaDownload|requestMediaRecovery)/);
  assert.match(retryVideoSource, /async[\s\S]{0,500}await (?:onRetryMedia|handleManualMediaDownload|requestMediaRecovery)/);
});

test("scroll lê o viewport real e todo agendamento visual tem cancelamento", () => {
  const scrollHandlerSource = sourceBetween(
    floatingChatSource,
    "const handleScrollArea",
    'writeFloatingChatPreference("whatsapp-hide-groups-floating"',
  );
  assert.match(scrollHandlerSource, /querySelector<HTMLElement>\("\[data-radix-scroll-area-viewport\]"\)/);
  assert.match(floatingChatSource, /<ScrollArea className="flex-1" onScrollCapture=\{handleScrollArea\}>/);

  const latestMessageScrollSource = sourceBetween(
    floatingChatSource,
    "if (!chatVisible || !activeConversationId)",
    "if (pendingMessage && activeConversation)",
  );
  assert.match(latestMessageScrollSource, /latestMessageScrollTimeoutRef\.current = window\.setTimeout/);
  assert.ok((latestMessageScrollSource.match(/window\.clearTimeout\(latestMessageScrollTimeoutRef\.current\)/g) || []).length >= 2);
  assert.match(latestMessageScrollSource, /return \(\) =>/);

  const historyAccessSource = sourceBetween(
    floatingChatSource,
    "const restrictedData = await",
    "if (restrictedData?.conversation)",
  );
  assert.doesNotMatch(historyAccessSource, /\bsetTimeout\(/);
  assert.match(floatingChatSource, /return \(\) => window\.cancelAnimationFrame\(focusFrame\)/);
  assert.match(floatingChatButtonSource, /return \(\) => window\.cancelAnimationFrame\(focusFrame\)/);
});

test("Escape, IME e nomes acessíveis preservam teclado e leitores de tela", () => {
  const escapeSource = sourceBetween(
    floatingChatSource,
    "const handleEscape = (event: KeyboardEvent)",
    'document.addEventListener("keydown", handleEscape)',
  );
  assert.match(escapeSource, /event\.isComposing/);
  assert.match(escapeSource, /showSessionSelector \|\| showAutomationDialog \|\| pendingDeleteConversation/);

  const keyPressSource = sourceBetween(
    floatingChatSource,
    "const handleKeyPress",
    "const handleSendAudio",
  );
  assert.match(keyPressSource, /e\.nativeEvent\.isComposing/);
  assert.match(keyPressSource, /e\.nativeEvent\.keyCode === 229/);

  assert.match(floatingChatSource, /role="dialog"/);
  assert.match(floatingChatSource, /aria-label="Chat do WhatsApp"/);
  assert.match(floatingChatSource, /aria-label="Voltar à lista de conversas"/);
  assert.match(floatingChatSource, /aria-label="Fechar chat do WhatsApp"/);
  assert.match(floatingChatSource, /inputAriaLabel="Digite sua mensagem"/);
  assert.match(floatingChatSource, /aria-label="Anexar arquivo"/);
  assert.match(floatingChatSource, /aria-label="Iniciar automação"/);
  assert.match(floatingChatSource, /motion-reduce:animate-none/);
  assert.match(floatingChatButtonSource, /aria-controls="floating-whatsapp-chat"/);
  assert.match(floatingChatButtonSource, /aria-expanded=\{state\.isOpen && !state\.isPresenceOpen\}/);
});

test("histórico e lista expõem paginação incremental com estado de carregamento", () => {
  assert.match(floatingChatSource, /hasOlderMessages/);
  assert.match(floatingChatSource, /onClick=\{\(\) => void loadOlderMessages\(\)\}/);
  assert.match(floatingChatSource, /disabled=\{isLoadingOlder\}/);
  assert.match(floatingChatSource, /Carregar mensagens anteriores/);

  assert.match(floatingChatSource, /hasMoreConversations/);
  assert.match(floatingChatSource, /onClick=\{\(\) => void loadMoreConversations\(\)\}/);
  assert.match(floatingChatSource, /disabled=\{isLoadingMoreConversations\}/);
  assert.match(floatingChatSource, /Carregar mais conversas/);
  assert.match(floatingChatSource, /useWhatsAppConversations\([\s\S]{0,520}\n    30,/);
  assert.match(floatingChatSource, /useWhatsAppMessagesPaginated\([\s\S]{0,180}pageSize: 30/);
});

test("histórico destaca a paginação antiga e oferece retorno às mensagens recentes", () => {
  for (const source of [floatingChatSource, conversationMessagesSource]) {
    assert.match(source, /data-load-older-messages/);
    assert.match(
      source,
      /data-load-older-messages[\s\S]{0,240}variant="default"[\s\S]{0,240}bg-primary[\s\S]{0,160}text-primary-foreground/,
    );
    assert.match(source, /data-scroll-to-latest/);
    assert.match(source, /aria-label="Ir para mensagens mais recentes"/);
    assert.match(source, /scrollIntoView\(\{ behavior: "smooth" \}\)/);
  }

  assert.match(floatingChatSource, /setShowScrollToLatest\(!isAtBottom\)/);
  assert.match(conversationMessagesSource, /awayFromBottom/);
  const pageScrollHandlers = conversationsScreenSource.match(/onScrollCapture=\{handleMessagesScroll\}/g) || [];
  assert.equal(pageScrollHandlers.length, 2);
});

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

test("Voltar e Fechar têm fundo cinza permanente na conversa aberta", () => {
  const activeHeaderSource = sourceBetween(
    floatingChatSource,
    "const displayName = activeConversation",
    "const DisconnectedState",
  );
  assert.match(
    activeHeaderSource,
    /aria-label="Voltar à lista de conversas"[\s\S]{0,280}bg-\[var\(--app-surface-soft\)\][\s\S]{0,160}hover:bg-\[var\(--app-surface-muted\)\]/,
  );
  assert.match(
    activeHeaderSource,
    /aria-label="Fechar chat do WhatsApp"[\s\S]{0,280}bg-\[var\(--app-surface-soft\)\][\s\S]{0,160}hover:bg-\[var\(--app-surface-muted\)\]/,
  );
});

test("MessageBubble é memoizado por conteúdo sem rerender global por callbacks", () => {
  assert.match(messageBubbleSource, /import \{ memo \} from "react"/);
  assert.match(messageBubbleSource, /const comparableMessageBubbleProps = \[/);
  for (const visibleProp of [
    "content",
    "messageType",
    "mediaUrl",
    "mediaStatus",
    "mediaError",
    "fromMe",
    "status",
    "sentAt",
    "senderName",
    "messageId",
    "isReacting",
  ]) {
    assert.match(messageBubbleSource, new RegExp(`"${visibleProp}"`));
  }
  assert.match(messageBubbleSource, /function messageBubblePropsAreEqual/);
  assert.match(messageBubbleSource, /Boolean\(previous\.onReact\) !== Boolean\(next\.onReact\)/);
  assert.match(messageBubbleSource, /Boolean\(previous\.onRetryMedia\) !== Boolean\(next\.onRetryMedia\)/);
  assert.match(messageBubbleSource, /previous\.reactions\.length !== next\.reactions\.length/);
  assert.match(messageBubbleSource, /reaction\.emoji === nextReaction\?\.emoji/);
  assert.match(messageBubbleSource, /reaction\.senderName === nextReaction\?\.senderName/);
  assert.match(messageBubbleSource, /reaction\.fromMe === nextReaction\?\.fromMe/);
  assert.match(messageBubbleSource, /export const MessageBubble = memo\(function MessageBubble/);
  assert.match(messageBubbleSource, /\}, messageBubblePropsAreEqual\);/);
  assert.match(messageBubbleSource, /MessageBubble\.displayName = "MessageBubble"/);
});
