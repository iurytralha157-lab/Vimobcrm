const POST_FORM_PREFIXES = [
  "ola! preenchi seu formulario e gostaria de saber mais sobre sua empresa.",
  "hi! i filled out your form and would like to learn more about your business.",
];

const trimPostFormText = (value: string): string =>
  value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");

const normalizePostFormText = (value: string): string =>
  trimPostFormText(value.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase())
    .replace(/\p{White_Space}+/gu, " ");

/**
 * Recognizes only the known Meta form follow-up envelope. This is not an ad
 * attribution or identity check: an ordinary CTWA message, a mention of a form,
 * or a quoted copy of the template must remain outside this classification.
 */
export function isWhatsAppPostFormFollowUp(content: unknown): boolean {
  if (typeof content !== "string") return false;

  const lines = trimPostFormText(content.replace(/\r\n?/gu, "\n")).split("\n");
  const firstField = lines.findIndex((line) => line.includes(":"));
  if (firstField <= 0) return false;

  const introduction = normalizePostFormText(lines.slice(0, firstField).join(" "));
  if (!POST_FORM_PREFIXES.includes(introduction)) return false;

  let hasPhone = false;
  let hasName = false;
  // Every nonempty body line must remain a structured answer. Narrative or
  // repeated identity fields make the template ambiguous and are not blocked.
  for (const rawLine of lines.slice(firstField)) {
    const line = trimPostFormText(rawLine);
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) return false;
    const label = trimPostFormText(line.slice(0, colon));
    const value = trimPostFormText(line.slice(colon + 1));
    if (!label || !value) return false;

    switch (normalizePostFormText(label)) {
      case "phone number":
      case "numero de telefone":
        if (hasPhone) return false;
        hasPhone = true;
        break;
      case "full name":
      case "nome completo":
        if (hasName) return false;
        hasName = true;
        break;
    }
  }
  return hasPhone && hasName;
}
