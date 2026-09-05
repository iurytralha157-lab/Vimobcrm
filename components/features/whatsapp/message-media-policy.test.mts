import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const policyModulePath = "./message-media-policy.ts";
const {
  getMessageMediaPolicyPresentation,
  MAX_MANUAL_MESSAGE_MEDIA_BYTES,
} = await import(policyModulePath);

test("explica bloqueios automaticos sem expor o erro interno", () => {
  assert.deepEqual(
    getMessageMediaPolicyPresentation({
      error: "media_policy_manual_only_type",
      kind: "video",
      sizeBytes: 12 * 1024 * 1024,
    }),
    {
      title: "Arquivo disponível para download",
      description: "Para proteger as conexões do WhatsApp, este arquivo de vídeo de 12 MB não foi baixado automaticamente.",
      canRequestDownload: true,
      isQueued: false,
    },
  );

  const unknownSize = getMessageMediaPolicyPresentation({
    error: "provider: media_policy_unknown_size",
    kind: "document",
    sizeBytes: null,
  });
  assert.equal(unknownSize?.title, "Tamanho do arquivo não informado");
  assert.equal(unknownSize?.canRequestDownload, false);
  assert.doesNotMatch(unknownSize?.description || "", /media_policy/);
});

test("oferece download manual somente dentro do teto absoluto", () => {
  assert.equal(MAX_MANUAL_MESSAGE_MEDIA_BYTES, 25 * 1024 * 1024);

  const image = getMessageMediaPolicyPresentation({
    error: "media_policy_too_large",
    kind: "image",
    sizeBytes: 12 * 1024 * 1024,
  });
  assert.equal(image?.canRequestDownload, true);
  assert.match(image?.description || "", /limitado a 10 MB/);

  const audio = getMessageMediaPolicyPresentation({
    error: "media_policy_too_large",
    kind: "audio",
    sizeBytes: 26 * 1024 * 1024,
  });
  assert.equal(audio?.canRequestDownload, false);
  assert.match(audio?.description || "", /limite máximo de 25 MB/);
});

test("mostra o estado assincrono da fila de midia", () => {
  assert.deepEqual(
    getMessageMediaPolicyPresentation({
      error: "media_manual_download_queued",
      kind: "document",
      sizeBytes: 8 * 1024 * 1024,
    }),
    {
      title: "Download na fila",
      description: "O arquivo aparecerá aqui assim que o processamento terminar.",
      canRequestDownload: false,
      isQueued: true,
    },
  );
});

test("bloqueia replay quando o resultado externo nao pode ser confirmado", () => {
  const outcomeUnknown = getMessageMediaPolicyPresentation({
    error: "media_provider_outcome_unknown",
    kind: "image",
    sizeBytes: 2 * 1024 * 1024,
  });
  assert.equal(outcomeUnknown?.title, "Processamento pausado por segurança");
  assert.equal(outcomeUnknown?.canRequestDownload, false);
  assert.equal(outcomeUnknown?.isQueued, false);
  assert.match(outcomeUnknown?.description || "", /suporte/);
  assert.doesNotMatch(outcomeUnknown?.description || "", /media_provider/);

  const retired = getMessageMediaPolicyPresentation({
    error: "media_legacy_job_retired",
    kind: "document",
    sizeBytes: 4 * 1024 * 1024,
  });
  assert.equal(retired?.canRequestDownload, true);
  assert.match(retired?.description || "", /nova fila/);
});

test("o balao oferece a acao manual e o estado de solicitacao", () => {
  const source = readFileSync("components/features/whatsapp/MessageBubble.tsx", "utf8");
  assert.match(source, /Baixar arquivo/);
  assert.match(source, /Solicitando download/);
  assert.match(source, /mediaPolicyPresentation\.isQueued/);
  assert.match(source, /handleManualMediaDownload/);
});
