import type { GroupedWhatsAppReaction } from "@/lib/whatsapp-reactions";

export function summarizeMessageReactions(reactions: readonly GroupedWhatsAppReaction[]) {
  const groups = new Map<string, { emoji: string; count: number }>();
  for (const reaction of reactions) {
    if (!reaction.emoji) continue;
    const group = groups.get(reaction.emoji);
    if (group) group.count += 1;
    else groups.set(reaction.emoji, { emoji: reaction.emoji, count: 1 });
  }
  return [...groups.values()];
}

export function isSingleReactionEmoji(value: string) {
  const text = value.trim();
  if (!text || text.length > 64 || /[\p{L}\p{N}]/u.test(text.replace(/[0-9]️?⃣/gu, ""))) return false;
  const segments = [...new Intl.Segmenter("pt-BR", { granularity: "grapheme" }).segment(text)];
  return segments.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(text);
}
