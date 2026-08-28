import type { CSSProperties } from 'react';

const HEX_COLOR_PATTERN = /^#([\da-f]{3}|[\da-f]{6})$/i;

function expandHexColor(value: string) {
  const hexadecimal = value.slice(1);
  return hexadecimal.length === 3
    ? hexadecimal
        .split('')
        .map((character) => character + character)
        .join('')
    : hexadecimal;
}

function relativeLuminance(hexadecimal: string) {
  const channels = [0, 2, 4].map(
    (offset) => Number.parseInt(hexadecimal.slice(offset, offset + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function getTagColorStyle(color?: string | null): CSSProperties {
  const normalizedColor = color?.trim();
  if (!normalizedColor || !HEX_COLOR_PATTERN.test(normalizedColor)) {
    return {
      backgroundColor: 'var(--primary)',
      color: 'var(--primary-foreground)',
    };
  }

  const hexadecimal = expandHexColor(normalizedColor);
  return {
    backgroundColor: normalizedColor,
    color: relativeLuminance(hexadecimal) > 0.179 ? '#0f172a' : '#ffffff',
  };
}
