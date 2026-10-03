import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readRepoFile = (path: string) => readFileSync(path, "utf8");

const apiSource = readRepoFile("lib/api/whatsapp.ts");
const hookSource = readRepoFile("hooks/use-whatsapp-attendance.ts");
const dialogSource = readRepoFile("components/features/whatsapp/EnterAttendanceDialog.tsx");
const conversationsSource = readRepoFile("components/features/whatsapp/ConversationsScreen.tsx");
const floatingSource = readRepoFile("components/features/chat/FloatingChat.tsx");
const leadThreadSource = readRepoFile("components/features/leads/LeadUnifiedThread.tsx");
const audioRecorderSource = readRepoFile("components/features/whatsapp/AudioRecorderButton.tsx");

const sourceBetween = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `inicio ausente: ${start}`);
  assert.ok(endIndex > startIndex, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

test("contrato de attendance usa card e WhatsApp selecionado em GET e POST", () => {
  const getAttendance = sourceBetween(apiSource, "async getConversationAttendance", "async joinConversationAttendance");
  assert.match(getAttendance, /whatsAppAttendanceRequestSchema/);
  assert.match(getAttendance, /query/);
  assert.match(getAttendance, /\/attendance/);
  assert.match(apiSource, /joinConversationAttendance[\s\S]*?method: 'POST'/);
  assert.ok((apiSource.match(/\/attendance`/g) || []).length >= 2);
  assert.match(hookSource, /whatsappQueryKeys\.attendance/);
  assert.match(hookSource, /queryClient\.setQueryData/);
  const ensureJoined = sourceBetween(hookSource, "const ensureJoined", "const confirmAttendance");
  assert.match(ensureJoined, /whatsappAPI\.getConversationAttendance/);
  assert.doesNotMatch(ensureJoined, /fetchQuery/);
  assert.match(hookSource, /pending\.identityKey !== requestIdentityRef\.current/);
});

test("dialogo explica confirmacao do envio, visibilidade e historico recebido", () => {
  assert.match(dialogSource, /Entrar no atendimento\?/);
  assert.match(dialogSource, /confirmação permite que você envie mensagens pelo WhatsApp selecionado/);
  assert.match(dialogSource, /Seus envios e sua participação no atendimento ficam registrados/);
  assert.match(dialogSource, /visíveis[\s\S]*quem tem acesso ao lead/);
  assert.match(dialogSource, /Ela não limita o recebimento/);
  assert.match(dialogSource, /mensagens recebidas antes da sua entrada[\s\S]*continuam no histórico do card/);
  assert.doesNotMatch(dialogSource, /Mensagens anteriores a esta entrada não serão acrescentadas ao histórico/);
});

test("as tres superficies passam pelo gate antes da mutacao de envio", () => {
  for (const [name, source] of [
    ["conversas", conversationsSource],
    ["flutuante", floatingSource],
    ["lead", leadThreadSource],
  ] as const) {
    assert.match(source, /useWhatsAppAttendanceGate/);
    assert.match(source, /<EnterAttendanceDialog/);
    assert.match(source, /attendanceGate\.ensureJoined/);
    assert.ok(
      source.indexOf("attendanceGate.ensureJoined") < source.lastIndexOf("sendMessage.mutateAsync")
        || source.indexOf("attendanceGate.ensureJoined") < source.lastIndexOf("sendTextMessage.mutateAsync"),
      `${name} deve confirmar antes do envio`,
    );
  }

  assert.match(conversationsSource, /attendanceEntries=\{attendanceGate\.entries\}/);
  assert.match(floatingSource, /attendanceGate\.entries\.map/);
  assert.doesNotMatch(leadThreadSource, /attendanceGate\.entries/);
  assert.match(hookSource, /\['lead-history-v2', target\.expectedLeadId\]/);
});

test("rascunho, audio e criacao de conversa aguardam confirmacao", () => {
  for (const [name, source, mutation] of [
    ["conversas", conversationsSource, "sendTextMessage.mutateAsync"],
    ["flutuante", floatingSource, "sendMessage.mutateAsync"],
  ] as const) {
    const send = sourceBetween(source, "const handleSendMessage", "const handleKeyPress");
    const confirm = send.indexOf("await attendanceGate.ensureJoined()");
    const check = send.indexOf("if (!joined)", confirm);
    const accept = send.indexOf("textSendGuard.accepted(intent)", check);
    const clear = send.indexOf("setMessageDrafts(", accept);
    const mutate = send.indexOf(mutation, clear);
    assert.ok(confirm >= 0 && confirm < check && check < accept && accept < clear && clear < mutate,
      `${name} deve confirmar atendimento antes de aceitar, limpar e enviar o rascunho`);
  }

  const leadSend = sourceBetween(leadThreadSource, "const handleSend = async", "const handleSendAudio");
  assert.ok(leadSend.indexOf("ensureConversationAndAttendanceForSend") < leadSend.indexOf("setText('')"));
  assert.match(leadThreadSource, /prepareTarget:[\s\S]*?ensureConversationForSend/);
  assert.match(audioRecorderSource, /if \(sent !== false\) clearRecording\(\)/);
});

test("arquivo cancelado pode ser escolhido novamente e reacoes tambem passam pelo gate", () => {
  for (const [source, inputName] of [
    [conversationsSource, "e"],
    [floatingSource, "e"],
    [leadThreadSource, "event"],
  ] as const) {
    const fileSend = sourceBetween(source, "const handleFileSelect", "const handleReactToMessage");
    assert.match(fileSend, new RegExp(`if \\(!targetConversation|if \\(!joined`));
    assert.match(fileSend, new RegExp(`${inputName}\\.target\\.value = [\"']{2}`));

    const reactionSend = sourceBetween(source, "const handleReactToMessage", source === leadThreadSource
      ? "const retryMediaDownload"
      : source === conversationsSource
        ? "const handleArchive"
        : "const connectedSessions");
    assert.ok(reactionSend.indexOf("ensureJoined") < reactionSend.indexOf("reactToMessage.mutateAsync"));
    assert.match(reactionSend, /sendSessionId: reactionSessionId/);
  }
});

test("eventos de entrada ficam cronologicos sem duplicar o timeline do lead", () => {
  assert.match(conversationsSource, /attendanceEntries=\{attendanceGate\.entries\}/);
  assert.match(floatingSource, /floatingTimelineItems[\s\S]*?attendanceGate\.entries\.map[\s\S]*?\.sort/);
  assert.doesNotMatch(leadThreadSource, /kind: ['\"]attendance['\"]/);
});
