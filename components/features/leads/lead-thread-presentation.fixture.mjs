import assert from 'node:assert/strict';

// Style and palette observation/assertions for the closed lead-history fixture.
// Expected colors stay independent of the product's presentation helper.
export function createHistoryPresentationFixture({ phase, events }) {
  async function typography(locator) {
    return locator.evaluate(node => { const s = getComputedStyle(node), r = node.getBoundingClientRect(); return {
      text: node.textContent, font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, line: s.lineHeight, color: s.color,
      bg: s.backgroundColor, radius: s.borderRadius, x: r.x, y: r.y, width: r.width, height: r.height,
    }; });
  }

  async function historySurface(page, eventId) {
    return page.locator(`[data-thread-item-id="event-${eventId}"]`).evaluate(row => {
      // Observe the rendered surface, rather than its Tailwind class or palette
      // helper. This also finds an absolute color layer behind opaque text.
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const rgba = color => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
      const opacity = element => { let result = 1; for (let current = element; current; current = current.parentElement) result *= Number(getComputedStyle(current).opacity); return result; };
      const candidates = [...row.querySelectorAll('*')].map(element => {
        const style = getComputedStyle(element), rect = element.getBoundingClientRect();
        return { element, style, rect, rgba: rgba(style.backgroundColor) };
      }).filter(candidate => candidate.rect.width >= 48 && candidate.rect.height >= 18 && candidate.rgba[3] > 0 && opacity(candidate.element) > 0);
      candidates.sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
      if (!candidates.length) throw Error(`No visible history surface for ${row.dataset.threadItemId}`);
      const target = candidates[0], effectiveAlpha = target.rgba[3] / 255 * opacity(target.element);
      let backdrop = [255, 255, 255, 255];
      for (let current = target.element.parentElement; current; current = current.parentElement) {
        const candidate = rgba(getComputedStyle(current).backgroundColor);
        if (candidate[3] === 255) { backdrop = candidate; break; }
      }
      const owner = target.style.position === 'absolute' && target.element.getAttribute('aria-hidden') === 'true' ? target.element.parentElement : target.element;
      const foreground = getComputedStyle(owner);
      return { background: target.style.backgroundColor, rgba: target.rgba, effectiveAlpha, backdrop,
        effectiveRGB: target.rgba.slice(0, 3).map((channel, index) => Math.round(channel * effectiveAlpha + backdrop[index] * (1 - effectiveAlpha))),
        usesOverlay: owner !== target.element, text: foreground.color, textRGBA: rgba(foreground.color), textOpacity: opacity(owner),
        borderColor: foreground.borderLeftColor, borderRGBA: rgba(foreground.borderLeftColor), borderWidth: foreground.borderLeftWidth, width: target.rect.width, height: target.rect.height };
    });
  }

  function assertHistoryColor(surface, tone, label, alpha = 1) {
    const [red, green, blue] = surface.rgba;
    const report = `${label}: ${JSON.stringify(surface)}`;
    assert.ok(Math.abs(surface.effectiveAlpha - alpha) < 0.02, `${label} keeps its intended color strength: ${report}`);
    if (tone === 'primary') assert.ok(Math.abs(red - 255) <= 3 && Math.abs(green - 69) <= 3 && Math.abs(blue - 41) <= 3, report);
    else if (tone === 'blue') assert.ok(blue > 180 && blue > red + 60 && blue > green + 40, report);
    else if (tone === 'violet') assert.ok(blue > 180 && red > 70 && red > green + 30 && blue > red + 50, report);
    else if (tone === 'green' || tone === 'emerald') {
      assert.ok(green > 100 && green > red + 50 && green > blue + 35, report);
      assert.ok(tone === 'green' ? blue / green < 0.55 : blue / green > 0.55, report);
    } else if (tone === 'red') assert.ok(red > 190 && green < 100 && blue < 110, report);
    else if (tone === 'amber') assert.ok(red > 160 && green > 50 && green < red && red - green < 150 && blue < 80, report);
    else if (tone === 'orange') assert.ok(red > 150 && red > green + 80 && green > blue + 20, report);
    else if (tone === 'zinc') assert.ok(Math.max(red, green, blue) - Math.min(red, green, blue) < 16 && red >= 35 && red <= 85, report);
    else assert.fail(`Unrecognized history tone ${tone}`);
  }

  async function coreHistoryPalette(page, theme) {
    const palette = {};
    for (const [key, index] of Object.entries({ created: 0, stage: 1, feedback: 2, meta: 3, webhook: 4, creative: 5, distribution: 6, queued: 7, manual: 8 })) {
      palette[key] = await historySurface(page, events[index].id);
    }
    if (phase !== 'baseline') {
      assertHistoryColor(palette.created, 'green', 'lead creation');
      assertHistoryColor(palette.stage, 'zinc', 'stage change');
      assertHistoryColor(palette.meta, 'blue', 'Meta form answer');
      assertHistoryColor(palette.creative, 'blue', 'Meta creative');
      assertHistoryColor(palette.webhook, 'primary', 'Webhook form answer');
      assertHistoryColor(palette.distribution, 'primary', 'automatic distribution', 0.5);
      assertHistoryColor(palette.manual, 'violet', 'manual transfer');
      assert.deepEqual(palette.feedback.rgba, theme === 'light' ? [255, 255, 255, 255] : [23, 23, 23, 255], 'feedback retains the neutral solid surface');
      assert.ok(palette.feedback.textRGBA.slice(0, 3).every(channel => theme === 'light' ? channel <= 40 : channel >= 240), 'neutral feedback retains readable primary text');
      for (const key of ['created', 'stage', 'meta', 'webhook', 'creative', 'manual']) assert.ok(palette[key].textRGBA.slice(0, 3).every(channel => channel >= 245), `${key} colored surface retains white foreground text`);
      assert.ok(palette.distribution.textRGBA.slice(0, 3).every(channel => channel >= 245) && palette.distribution.textOpacity >= 0.98, 'automatic distribution text stays opaque white over its half-strength background');
      assert.equal(new Set(['created', 'stage', 'feedback', 'meta', 'webhook', 'distribution', 'manual'].map(key => JSON.stringify([palette[key].rgba, palette[key].effectiveAlpha]))).size, 7, 'seven history purposes retain visibly distinct surface treatments');
    }
    return palette;
  }

  return { typography, historySurface, assertHistoryColor, coreHistoryPalette };
}
