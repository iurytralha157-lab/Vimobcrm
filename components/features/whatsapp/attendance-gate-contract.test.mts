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

test("dialogo separa entrada no atendimento de vinculo e historico", () => {
  assert.match(dialogSource, /Entrar no atendimento\?/);
  assert.match(dialogSource, /enviar pelo CRM usando o WhatsApp selecionado/);
  assert.match(dialogSource, /visíveis para quem tem acesso ao lead/);
  assert.match(dialogSource, /A entrada no atendimento não anexa histórico antigo/);
  assert.match(dialogSource, /anexado automaticamente quando você confirma o vínculo/);
});

test("as duas superficies de envio passam pelo gate antes da mutacao", () => {
  for (const [name, source] of [
    ["conversas", conversationsSource],
    ["flutuante", floatingSource],
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
  const mainSend = sourceBetween(conversationsSource, "const handleSendMessage", "const handleKeyPress");
  assert.ok(mainSend.indexOf("ensureJoined") < mainSend.indexOf('setMessageText("")'));

  const floatingSend = sourceBetween(floatingSource, "const handleSendMessage", "const handleKeyPress");
  assert.ok(floatingSend.indexOf("ensureJoined") < floatingSend.indexOf('setMessageText("")'));

  assert.match(audioRecorderSource, /result\?\.state === "unconfirmed"[\s\S]*?return;/);
  assert.match(audioRecorderSource, /if \(result !== false && !\(typeof result === "object" && result\?\.state === "cancelled"\)\) clearRecording\(\)/);
});

test("arquivo cancelado pode ser escolhido novamente e reacoes tambem passam pelo gate", () => {
  for (const source of [conversationsSource, floatingSource]) {
    const fileSend = sourceBetween(source, "const handleFileSelect", "const handleReactToMessage");
    assert.match(fileSend, new RegExp(`if \\(!targetConversation|if \\(!joined`));
    assert.match(fileSend, /const input = 'target' in selection \? selection\.target : null/);
    assert.match(fileSend, /if \(input\) input\.value = ["']{2}/);

    const reactionSend = sourceBetween(source, "const handleReactToMessage", source === conversationsSource
        ? "const handleArchive"
        : "const connectedSessions");
    assert.ok(reactionSend.indexOf("ensureJoined") < reactionSend.indexOf("reactToMessage.mutateAsync"));
    assert.match(reactionSend, /sendSessionId: reactionSessionId/);
  }
});

test("eventos de entrada ficam cronologicos sem duplicar o timeline do lead", () => {
  assert.match(conversationsSource, /attendanceEntries=\{attendanceGate\.entries\}/);
  assert.match(floatingSource, /floatingTimelineItems[\s\S]*?sortWhatsAppTimelineItems\(\[[\s\S]*?attendanceGate\.entries\.map/);
  assert.doesNotMatch(leadThreadSource, /kind: ['\"]attendance['\"]/);
});
