/** Presentation only: keep the registered name and identifiers unchanged. */
export function formatWhatsAppPersonName(value: string | null | undefined): string {
  const name = value?.trim().replace(/\s+/gu, " ") || "";
  if (!name || /[\d<>_/@\\]/u.test(name)) return name;
  return name.toLocaleLowerCase("pt-BR").replace(
    /(^|[\s'’\-])(\p{L})/gu,
    (_, separator: string, letter: string) => separator + letter.toLocaleUpperCase("pt-BR"),
  );
}
