// WhatsApp label color is a provider index stored as PostgreSQL int4, not CSS.
const POSTGRES_INT4_MIN = -2_147_483_648;
const POSTGRES_INT4_MAX = 2_147_483_647;

function decimalColorIndex(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^-?\d+$/.test(value.trim())
    ? Number(value.trim())
    : Number.NaN;
  return Number.isInteger(parsed) && parsed >= POSTGRES_INT4_MIN && parsed <= POSTGRES_INT4_MAX
    ? parsed
    : null;
}

export function normalizeEvolutionLabelColor(label: Record<string, unknown>): number | null {
  for (const value of [label.color, label.Color, label.colorIndex]) {
    const index = decimalColorIndex(value);
    if (index !== null) return index;
  }
  return null;
}
