import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPipelineStageColorForeground,
  getPipelineStageColorStyle,
  isPipelineStageColorDraft,
  normalizePipelineStageColor,
  PIPELINE_STAGE_COLOR_PRESETS,
} from './pipeline-stage-colors';

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

function contrastRatio(background: string, foreground: string) {
  const backgroundLuminance = relativeLuminance(background);
  const foregroundLuminance = relativeLuminance(foreground);
  const lighter = Math.max(backgroundLuminance, foregroundLuminance);
  const darker = Math.min(backgroundLuminance, foregroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

test('preserva uma paleta de estágios única e válida', () => {
  const colors = PIPELINE_STAGE_COLOR_PRESETS.map((preset) => preset.value);

  assert.equal(colors.length, 18);
  assert.equal(new Set(colors).size, colors.length);
  colors.forEach((color) => assert.equal(normalizePipelineStageColor(color), color));
});

test('normaliza somente cores completas no contrato #RRGGBB', () => {
  assert.equal(normalizePipelineStageColor('  #A1B2C3  '), '#a1b2c3');

  ['', '#', '#123', '#12345', '#12345g', 'red', 'url(example)'].forEach((color) => {
    assert.equal(normalizePipelineStageColor(color), null);
  });
});

test('aceita rascunhos hexadecimais sem promovê-los a uma cor confirmada', () => {
  ['', '#', '#1', '#12ab', '#12abEF'].forEach((color) => {
    assert.equal(isPipelineStageColorDraft(color), true);
  });
  ['12abef', '#12abef0', '#12abeg', 'red'].forEach((color) => {
    assert.equal(isPipelineStageColorDraft(color), false);
  });
});

test('escolhe um indicador com contraste WCAG em toda a paleta', () => {
  PIPELINE_STAGE_COLOR_PRESETS.forEach((preset) => {
    const foreground = getPipelineStageColorForeground(preset.value);
    assert.ok(
      contrastRatio(preset.value, foreground) >= 4.5,
      `${preset.value} precisa manter contraste de texto AA`,
    );
  });
});

test('produz estilo seguro para consumidores de cores de estagio', () => {
  assert.deepEqual(getPipelineStageColorStyle('javascript:alert(1)'), {
    backgroundColor: 'var(--app-surface-soft)',
    borderColor: 'var(--app-border)',
    color: 'var(--app-text-secondary)',
  });

  const style = getPipelineStageColorStyle('  #A1B2C3  ');
  assert.equal(style.backgroundColor, '#a1b2c3');
  assert.equal(style.borderColor, '#a1b2c3');
  assert.ok(contrastRatio(style.backgroundColor, style.color) >= 4.5);

  for (const color of ['#000000', '#ffffff']) {
    const customStyle = getPipelineStageColorStyle(color);
    assert.ok(contrastRatio(customStyle.backgroundColor, customStyle.color) >= 4.5);
  }
});
