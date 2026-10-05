import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const hook = read("hooks/use-whatsapp-send-origin-choice.ts");
const dialog = read("components/features/whatsapp/WhatsAppSendOriginChoice.tsx");
const recorder = read("components/features/whatsapp/AudioRecorderButton.tsx");
const screens = [
  ["Conversas", read("components/features/whatsapp/ConversationsScreen.tsx"), "const handleSendMessage"],
  ["Chat flutuante", read("components/features/chat/FloatingChat.tsx"), "const handleSendMessage"],
  ["Histórico do lead", read("components/features/leads/LeadUnifiedThread.tsx"), "const handleSend = async"],
] as const;

function between(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} → ${end}`);
  return source.slice(from, to);
}

test("a escolha de origem abre em uma tentativa de envio e cancelamento não autoriza envio", () => {
  const choose = between(hook, "chooseForSend:", "continueWithEntry:");
  assert.match(choose, /if \(pendingRef\.current\) return Promise\.resolve\(null\)/);
  assert.match(choose, /setOpen\(true\)/);
  assert.match(hook, /pending\.choiceKey !== choiceKey \|\| !required/);
  assert.match(hook, /cancel: \(\) => finishChoice\(null\)/);
  assert.match(dialog, /<AlertDialog open=\{open\}/);
  assert.match(dialog, /onOpenChange=\{\(nextOpen\) => \{ if \(!nextOpen\) onCancel\(\); \}\}/);
});

test("texto e áudio aguardam escolha antes do consentimento e preservam o preparo ao mudar de número", () => {
  for (const [name, source, textStart] of screens) {
    const textSend = between(source, textStart, "const handleSendAudio");
    const choiceAt = textSend.indexOf("await sendOriginChoice.chooseForSend()");
    const ownAt = textSend.indexOf("await handleStartWithOwnSession(origin.sessionId)");
    const attendanceAt = name === "Histórico do lead"
      ? textSend.indexOf("await ensureConversationAndAttendanceForSend()")
      : textSend.indexOf("await attendanceGate.ensureJoined()");
    assert.ok(choiceAt >= 0 && choiceAt < ownAt && ownAt < attendanceAt,
      `${name}: a origem precisa preceder consentimento e envio`);
    const abortedAt = textSend.lastIndexOf("textSendGuard.aborted(intent)", ownAt);
    assert.ok(abortedAt >= 0 && abortedAt < ownAt,
      `${name}: mudar de número deve liberar a intenção sem limpar o texto`);

    const audioSend = between(source, "const handleSendAudio", "const handleFileSelect");
    assert.ok(audioSend.indexOf("await sendOriginChoice.chooseForSend()")
      < audioSend.indexOf(name === "Histórico do lead"
        ? "await ensureConversationAndAttendanceForSend()"
        : "await attendanceGate.ensureJoined()"),
    `${name}: áudio preparado deve pedir origem antes do consentimento`);
    assert.match(audioSend, /origin\.kind === ['"]own['"][\s\S]*?return false/);
    assert.equal((source.match(/<WhatsAppSendOriginChoice/g) || []).length, 1,
      `${name}: deve existir apenas um diálogo de origem por superfície`);
  }
  assert.match(recorder, /if \(sent !== false\) clearRecording\(\)/);
});

test("a origem pendente não bloqueia a digitação antes de Enviar", () => {
  const [conversations, floating, lead] = screens.map(([, source]) => source);
  assert.doesNotMatch(between(conversations, "const messageInputDisabled", "const messageInputPlaceholder"), /sendOriginChoice\.required/);
  assert.doesNotMatch(between(floating, "const messageInputDisabled", "const floatingTimelineItems"), /sendOriginChoice\.required/);
  assert.doesNotMatch(between(lead, "const canSendMessage", "const inputPlaceholder"), /sendOriginChoice\.required/);
});
