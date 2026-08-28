const PIPELINE_STAGE_HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const PIPELINE_STAGE_HEX_COLOR_DRAFT_PATTERN = /^#[0-9a-f]{0,6}$/i;

const DARK_STAGE_COLOR_FOREGROUND = '#000000';
const LIGHT_STAGE_COLOR_FOREGROUND = '#ffffff';

// Domain data persisted on pipeline stages. These values are intentionally
// literal colors rather than theme tokens, so a user's choice is theme-stable.
export const PIPELINE_STAGE_COLOR_PRESETS = [
  { value: '#0891b2', label: 'Ciano' },
  { value: '#3b82f6', label: 'Azul' },
  { value: '#8b5cf6', label: 'Violeta' },
  { value: '#ec4899', label: 'Rosa' },
  { value: '#22c55e', label: 'Verde' },
  { value: '#f59e0b', label: 'Âmbar' },
  { value: '#ef4444', label: 'Vermelho' },
  { value: '#14b8a6', label: 'Turquesa' },
  { value: '#6366f1', label: 'Índigo' },
  { value: '#f43f5e', label: 'Coral' },
  { value: '#84cc16', label: 'Lima' },
  { value: '#06b6d4', label: 'Ciano claro' },
  { value: '#a855f7', label: 'Roxo' },
  { value: '#eab308', label: 'Amarelo' },
  { value: '#10b981', label: 'Esmeralda' },
  { value: '#f97316', label: 'Laranja' },
  { value: '#0ea5e9', label: 'Azul-céu' },
  { value: '#d946ef', label: 'Magenta' },
] as const;

export const PIPELINE_STAGE_COLOR_FALLBACK = PIPELINE_STAGE_COLOR_PRESETS[4].value;

export function normalizePipelineStageColor(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return PIPELINE_STAGE_HEX_COLOR_PATTERN.test(normalized) ? normalized : null;
}

export function isPipelineStageColorDraft(value: string) {
  return value === '' || PIPELINE_STAGE_HEX_COLOR_DRAFT_PATTERN.test(value);
}

function relativeLuminance(color: string) {
  const hexadecimal = color.slice(1);
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(hexadecimal.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });

  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

export function getPipelineStageColorForeground(value: string) {
  const color = normalizePipelineStageColor(value);
  if (!color) return 'var(--app-text-primary)';

  return relativeLuminance(color) > 0.179
    ? DARK_STAGE_COLOR_FOREGROUND
    : LIGHT_STAGE_COLOR_FOREGROUND;
}

export function getPipelineStageColorStyle(value?: string | null) {
  const backgroundColor = value ? normalizePipelineStageColor(value) : null;
  if (!backgroundColor) {
    return {
      backgroundColor: 'var(--app-surface-soft)',
      borderColor: 'var(--app-border)',
      color: 'var(--app-text-secondary)',
    };
  }

  return {
    backgroundColor,
    borderColor: backgroundColor,
    color: getPipelineStageColorForeground(backgroundColor),
  };
}
