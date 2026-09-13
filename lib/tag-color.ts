import type { CSSProperties } from 'react';

const HEX_COLOR_PATTERN = /^#([\da-f]{3}|[\da-f]{6})$/i;
const HEX_COLOR_WITH_OPTIONAL_ALPHA_PATTERN = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i;
const MAX_LUMINANCE_FOR_WHITE_TEXT = 0.179;

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

function darkenHexForWhiteText(hexadecimal: string) {
  if (relativeLuminance(hexadecimal) <= MAX_LUMINANCE_FOR_WHITE_TEXT) {
    return `#${hexadecimal}`;
  }

  const channels = [0, 2, 4].map((offset) => Number.parseInt(hexadecimal.slice(offset, offset + 2), 16));
  let lowerScale = 0;
  let upperScale = 1;

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const candidateScale = (lowerScale + upperScale) / 2;
    const candidate = channels
      .map((channel) => Math.round(channel * candidateScale).toString(16).padStart(2, '0'))
      .join('');

    if (relativeLuminance(candidate) <= MAX_LUMINANCE_FOR_WHITE_TEXT) {
      lowerScale = candidateScale;
    } else {
      upperScale = candidateScale;
    }
  }

  const darkened = channels
    .map((channel) => Math.round(channel * lowerScale).toString(16).padStart(2, '0'))
    .join('');
  return `#${darkened}`;
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

export function getTagColorStyleWithWhiteText(color?: string | null): CSSProperties {
  const normalizedColor = color?.trim();
  if (!normalizedColor || !HEX_COLOR_PATTERN.test(normalizedColor)) {
    return {
      backgroundColor: 'var(--primary)',
      color: '#ffffff',
    };
  }

  return {
    backgroundColor: darkenHexForWhiteText(expandHexColor(normalizedColor)),
    color: '#ffffff',
  };
}

export function getContrastTextClass(
  backgroundColor: string,
  invalidColorFallback = 'text-white',
) {
  const match = backgroundColor.trim().match(HEX_COLOR_WITH_OPTIONAL_ALPHA_PATTERN);
  if (!match) return invalidColorFallback;

  const hexadecimal = match[1].length === 3
    ? match[1]
        .split('')
        .map((character) => character + character)
        .join('')
    : match[1].slice(0, 6);

  return relativeLuminance(hexadecimal) > 0.179 ? 'text-slate-950' : 'text-white';
}
