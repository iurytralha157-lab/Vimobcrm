import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { OutboundImageCompressionRuntime } from "./message-media.ts";

const messageMediaModulePath = "./message-media.ts";
const {
  blobToBase64,
  buildMessageMediaFilename,
  compressOutboundImageFile,
  getMessageMediaExtension,
  getMessageMediaPolicyPresentation,
  getOutboundMessageMediaKind,
  getSafeAvatarUrl,
  getSafeMessageMediaUrl,
  MAX_MANUAL_MESSAGE_MEDIA_BYTES,
  MAX_OUTBOUND_MESSAGE_MEDIA_BYTES,
  OUTBOUND_IMAGE_COMPRESSION_PROFILES,
  sanitizeMediaFilename,
} = await import(messageMediaModulePath);

const createImageRuntime = ({
  width = 2400,
  height = 1200,
  outputSize = 400_000,
  loadError = null,
}: {
  width?: number;
  height?: number;
  outputSize?: number | null;
  loadError?: Error | null;
} = {}): {
  calls: {
    createdObjectUrls: number;
    revokedUrls: string[];
    encodes: Array<{
      targetWidth: number;
      targetHeight: number;
      mimeType: string;
      quality: number;
    }>;
    filenames: string[];
  };
  runtime: OutboundImageCompressionRuntime;
} => {
  const calls: {
    createdObjectUrls: number;
    revokedUrls: string[];
    encodes: Array<{
      targetWidth: number;
      targetHeight: number;
      mimeType: string;
      quality: number;
    }>;
    filenames: string[];
  } = {
    createdObjectUrls: 0,
    revokedUrls: [],
    encodes: [],
    filenames: [],
  };

  return {
    calls,
    runtime: {
      createObjectUrl() {
        calls.createdObjectUrls += 1;
        return "blob:test-image";
      },
      revokeObjectUrl(url) {
        calls.revokedUrls.push(url);
      },
      async loadImage() {
        if (loadError) throw loadError;
        return { width, height, source: {} };
      },
      async encodeImage(_image, targetWidth, targetHeight, mimeType, quality) {
        calls.encodes.push({ targetWidth, targetHeight, mimeType, quality });
        if (outputSize === null) return null;
        return new Blob([new Uint8Array(outputSize)], { type: mimeType });
      },
      createFile(blob, filename, mimeType) {
        calls.filenames.push(filename);
        return new File([blob], filename, { type: mimeType });
      },
    },
  };
};

test("mantém o mesmo limite de mídia nos dois compositores ativos", () => {
  assert.equal(MAX_OUTBOUND_MESSAGE_MEDIA_BYTES, 5 * 1024 * 1024);

  for (const sourcePath of [
    "components/features/whatsapp/ConversationsScreen.tsx",
    "components/features/chat/FloatingChat.tsx",
  ]) {
    const source = readFileSync(sourcePath, "utf8");
    assert.match(source, /file\.size\s*>\s*MAX_OUTBOUND_MESSAGE_MEDIA_BYTES/);
    assert.match(source, /processedFile\.size\s*>\s*MAX_OUTBOUND_MESSAGE_MEDIA_BYTES/);
  }
});

test("centraliza extensão, tipo e conversão base64 de mídia de saída", async () => {
  assert.equal(getMessageMediaExtension("audio/ogg; codecs=opus"), "ogg");
  assert.equal(getMessageMediaExtension(" application/pdf "), "pdf");
  assert.equal(getMessageMediaExtension("application/x-custom", "dat"), "dat");
  assert.equal(getOutboundMessageMediaKind("image/webp"), "image");
  assert.equal(getOutboundMessageMediaKind("video/mp4"), "video");
  assert.equal(getOutboundMessageMediaKind("audio/webm"), "audio");
  assert.equal(getOutboundMessageMediaKind("application/pdf"), "document");

  const fakeReader: {
    result: string | ArrayBuffer | null;
    onload: ((event?: unknown) => void) | null;
    onerror: ((reason?: unknown) => void) | null;
    readAsDataURL(blob: Blob): void;
  } = {
    result: null,
    onload: null,
    onerror: null,
    readAsDataURL() {
      this.result = "data:application/octet-stream;base64,YXJxdWl2bw==";
      this.onload?.();
    },
  };
  assert.equal(await blobToBase64(new Blob(["arquivo"]), fakeReader), "YXJxdWl2bw==");
});

test("mantém PNG no chat flutuante e limita a maior dimensão a 1600px", async () => {
  const source = new File([new Uint8Array(900_000)], "planta.png", { type: "image/png" });
  const { calls, runtime } = createImageRuntime({ outputSize: 950_000 });

  const result = await compressOutboundImageFile(
    source,
    OUTBOUND_IMAGE_COMPRESSION_PROFILES.preservePngEncoding,
    runtime,
  );

  assert.notEqual(result, source);
  assert.equal(result.type, "image/png");
  assert.equal(result.name, "planta.png");
  assert.deepEqual(calls.encodes, [{
    targetWidth: 1600,
    targetHeight: 800,
    mimeType: "image/png",
    quality: 0.82,
  }]);
  assert.deepEqual(calls.revokedUrls, ["blob:test-image"]);
});

test("perfil de menor payload converte PNG e descarta resultado maior", async () => {
  const source = new File([new Uint8Array(900_000)], "planta.png", { type: "image/png" });
  const smallerRuntime = createImageRuntime({ outputSize: 400_000 });
  const smaller = await compressOutboundImageFile(
    source,
    OUTBOUND_IMAGE_COMPRESSION_PROFILES.preferSmallerFile,
    smallerRuntime.runtime,
  );

  assert.notEqual(smaller, source);
  assert.equal(smaller.type, "image/webp");
  assert.equal(smaller.name, "planta.webp");

  const largerRuntime = createImageRuntime({ outputSize: 950_000 });
  const larger = await compressOutboundImageFile(
    source,
    OUTBOUND_IMAGE_COMPRESSION_PROFILES.preferSmallerFile,
    largerRuntime.runtime,
  );
  assert.equal(larger, source);
  assert.deepEqual(largerRuntime.calls.revokedUrls, ["blob:test-image"]);
});

test("perfis preservam as divergências de JPEG e de erro", async () => {
  const source = new File([new Uint8Array(900_000)], "fachada.jpg", { type: "image/jpeg" });

  const pngProfileRuntime = createImageRuntime();
  const converted = await compressOutboundImageFile(
    source,
    OUTBOUND_IMAGE_COMPRESSION_PROFILES.preservePngEncoding,
    pngProfileRuntime.runtime,
  );
  assert.equal(converted.type, "image/webp");

  const smallerProfileRuntime = createImageRuntime();
  const preserved = await compressOutboundImageFile(
    source,
    OUTBOUND_IMAGE_COMPRESSION_PROFILES.preferSmallerFile,
    smallerProfileRuntime.runtime,
  );
  assert.equal(preserved.type, "image/jpeg");

  const processingError = new Error("imagem inválida");
  await assert.rejects(
    compressOutboundImageFile(
      source,
      OUTBOUND_IMAGE_COMPRESSION_PROFILES.preservePngEncoding,
      createImageRuntime({ loadError: processingError }).runtime,
    ),
    processingError,
  );
  assert.equal(
    await compressOutboundImageFile(
      source,
      OUTBOUND_IMAGE_COMPRESSION_PROFILES.preferSmallerFile,
      createImageRuntime({ loadError: processingError }).runtime,
    ),
    source,
  );
});

test("não processa GIF e preserva o fallback de nome da timeline", async () => {
  const gif = new File([new Uint8Array(1_000_000)], "animacao.gif", { type: "image/gif" });
  const skippedRuntime = createImageRuntime();
  assert.equal(
    await compressOutboundImageFile(
      gif,
      OUTBOUND_IMAGE_COMPRESSION_PROFILES.preferSmallerFile,
      skippedRuntime.runtime,
    ),
    gif,
  );
  assert.equal(skippedRuntime.calls.createdObjectUrls, 0);

  const unnamed = new File([new Uint8Array(900_000)], ".png", { type: "image/png" });
  const timelineRuntime = createImageRuntime();
  const timelineResult = await compressOutboundImageFile(
    unnamed,
    {
      ...OUTBOUND_IMAGE_COMPRESSION_PROFILES.preferSmallerFile,
      fallbackBaseName: "imagem",
    },
    timelineRuntime.runtime,
  );
  assert.equal(timelineResult.name, "imagem.webp");
});

test("os três consumidores usam a implementação canônica e perfis explícitos", () => {
  const sources = {
    floating: readFileSync("components/features/chat/FloatingChat.tsx", "utf8"),
    lead: readFileSync("components/features/leads/LeadUnifiedThread.tsx", "utf8"),
    conversations: readFileSync("components/features/whatsapp/ConversationsScreen.tsx", "utf8"),
  };

  for (const source of Object.values(sources)) {
    assert.doesNotMatch(source, /const\s+fileToBase64\s*=/);
    assert.doesNotMatch(source, /async\s+function\s+compressImageFile/);
    assert.match(source, /blobToBase64/);
    assert.match(source, /compressOutboundImageFile/);
    assert.match(source, /getMessageMediaExtension/);
    assert.match(source, /getOutboundMessageMediaKind/);
  }

  assert.match(sources.floating, /OUTBOUND_IMAGE_COMPRESSION_PROFILES\.preservePngEncoding/);
  assert.match(sources.lead, /OUTBOUND_IMAGE_COMPRESSION_PROFILES\.preferSmallerFile/);
  assert.match(sources.lead, /fallbackBaseName:\s*'imagem'/);
  assert.match(sources.conversations, /OUTBOUND_IMAGE_COMPRESSION_PROFILES\.preferSmallerFile/);
});

test("aceita apenas URLs remotas renderizáveis e sem credenciais", () => {
  assert.equal(
    getSafeMessageMediaUrl("https://storage.example.com/media/file.jpg?token=a%2Bb", "image"),
    "https://storage.example.com/media/file.jpg?token=a%2Bb",
  );
  assert.equal(getSafeMessageMediaUrl("javascript:alert(1)", "image"), null);
  assert.equal(getSafeMessageMediaUrl("data:image/png;base64,aGVsbG8=", "image"), "data:image/png;base64,aGVsbG8=");
  assert.equal(getSafeMessageMediaUrl("data:image/svg+xml;base64,PHN2Zy8+", "image"), null);
  assert.equal(getSafeMessageMediaUrl("data:image/png;base64,aGVsbG8=", "audio"), null);
  assert.equal(getSafeMessageMediaUrl("https://user:secret@example.com/file.jpg", "image"), null);
  assert.equal(getSafeMessageMediaUrl("https://example.com/file.enc", "audio"), null);
  assert.equal(getSafeMessageMediaUrl("https://example.com/file%2Eenc", "audio"), null);
});

test("bloqueia endpoints criptografados do provedor sem quebrar avatar remoto", () => {
  assert.equal(getSafeMessageMediaUrl("https://mmg.whatsapp.net/media/file.jpg", "image"), null);
  assert.equal(getSafeMessageMediaUrl("https://pps.whatsapp.net/avatar.jpg", "image"), null);
  assert.equal(getSafeMessageMediaUrl("https://a.whatsapp.net/sticker.webp", "sticker"), null);
  assert.equal(getSafeAvatarUrl("https://pps.whatsapp.net/avatar.jpg"), "https://pps.whatsapp.net/avatar.jpg");
});

test("higieniza nomes de download e remove controles de direcao", () => {
  assert.equal(sanitizeMediaFilename("../../relatorio\u202Efdp.exe"), "relatoriofdp.exe");
  assert.equal(sanitizeMediaFilename("  contrato:<final>?.pdf  "), "contrato__final__.pdf");
  assert.equal(sanitizeMediaFilename("...", "Documento.pdf"), "Documento.pdf");
});

test("nome de midia usa conteudo apenas quando ele representa arquivo", () => {
  assert.equal(
    buildMessageMediaFilename({
      content: "foto do apartamento",
      kind: "image",
      mimeType: "image/jpeg",
      sentAt: "2026-08-16T12:34:00",
    }),
    "Imagem-20260816-1234.jpg",
  );
  assert.equal(
    buildMessageMediaFilename({
      content: "proposta-final.pdf",
      kind: "document",
      mimeType: "application/pdf",
      sentAt: null,
    }),
    "proposta-final.pdf",
  );
});

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

test("mostra o estado assíncrono da fila de mídia", () => {
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

test("a mídia do balão oferece a ação manual e o estado de solicitação", () => {
  const source = readFileSync("components/features/whatsapp/message-bubble/MessageMedia.tsx", "utf8");
  assert.match(source, /Baixar arquivo/);
  assert.match(source, /Solicitando download/);
  assert.match(source, /mediaPolicyPresentation\.isQueued/);
  assert.match(source, /handleManualMediaDownload/);
});
