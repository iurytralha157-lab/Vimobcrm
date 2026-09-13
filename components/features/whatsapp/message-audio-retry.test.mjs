import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("audio playback failure requests backend media recovery", () => {
  const player = readFileSync(
    "components/features/whatsapp/message-bubble/MessageAudioPlayer.tsx",
    "utf8",
  );
  const media = readFileSync(
    "components/features/whatsapp/message-bubble/MessageMedia.tsx",
    "utf8",
  );
  const messages = readFileSync(
    "components/features/whatsapp/conversations/ConversationMessages.tsx",
    "utf8",
  );
  const screen = readFileSync(
    "components/features/whatsapp/ConversationsScreen.tsx",
    "utf8",
  );

  assert.match(player, /onRetryMedia\?: \(\) => void \| Promise<void>/);
  assert.match(player, /await onRetryMedia\(\)/);
  assert.match(player, /disabled=\{isRetryingMedia\}/);
  assert.match(media, /<MessageAudioPlayer[\s\S]*onRetryMedia=\{onRetryMedia\}/);
  assert.match(messages, /onRetryMedia: \(messageId: string\) => Promise<void>/);
  assert.match(screen, /onRetryMedia=\{retryMediaDownload\}/);
  assert.doesNotMatch(screen, /onRetryMedia=\{\(messageId\) => void retryMediaDownload\(messageId\)\}/);
});
