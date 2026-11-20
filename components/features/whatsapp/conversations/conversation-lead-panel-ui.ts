export const sectionTitleClassName = "leading-none";
export const sectionTitleStyle = {
  color: "var(--app-text-secondary)",
  fontSize: "11px",
  fontWeight: 400,
  letterSpacing: 0,
};
export const panelSectionClassName =
  "min-w-0 rounded-[8px] bg-[var(--app-surface-soft)] p-3";

export function safeExternalURL(value: unknown) {
  const text = value == null ? "" : String(value).trim();
  if (!text) return "";

  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}
