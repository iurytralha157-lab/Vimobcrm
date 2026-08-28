export const SITE_THEME_COLOR_DEFAULTS = Object.freeze({
  accent: "#3B82F6",
  background: "#0D0D0D",
  card: "#FFFFFF",
  primary: "#F97316",
  secondary: "#1E293B",
  text: "#FFFFFF",
});

export const SITE_THEME_COLOR_PRESETS = Object.freeze({
  dark: Object.freeze({
    background: SITE_THEME_COLOR_DEFAULTS.background,
    text: SITE_THEME_COLOR_DEFAULTS.text,
  }),
  light: Object.freeze({
    background: "#FFFFFF",
    text: "#1A1A1A",
  }),
});

export const SITE_THEME_PREVIEW_TEXT = Object.freeze({
  primary: "#1A1A1A",
  secondary: "#6B7280",
});
