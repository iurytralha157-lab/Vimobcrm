import assert from 'node:assert/strict';
import test from 'node:test';

import { getPipelineBoardLayout, PIPELINE_LAYOUT } from '@/config/pipeline-layout';

test('small desktop boards fit four readable columns in their actual available width', () => {
  for (const width of [1000, 1086, 1160, 1238]) {
    const layout = getPipelineBoardLayout(width, 572, false);
    const occupied = layout.columnWidth * 4 + layout.columnGap * 3 + PIPELINE_LAYOUT.boardPaddingPx * 2;
    assert.ok(occupied <= width, `${occupied}px exceeds the ${width}px board`);
    assert.ok(layout.columnWidth >= 240);
    assert.ok(layout.columnWidth <= 288);
  }
});

test('sidebar expansion changes the column geometry independently of the viewport', () => {
  const openSidebar = getPipelineBoardLayout(1000, 620, false);
  const collapsedSidebar = getPipelineBoardLayout(1152, 620, false);
  assert.ok(collapsedSidebar.columnWidth > openSidebar.columnWidth);
  assert.equal(openSidebar.columnGap, collapsedSidebar.columnGap);
});

test('fewer stages keep their normal width instead of reserving space for absent stages', () => {
  assert.equal(getPipelineBoardLayout(1000, 572, false, 3).columnWidth, 288);
  assert.equal(getPipelineBoardLayout(700, 572, false, 2).columnWidth, 288);
});

test('short boards recover vertical space through spacing without a font-size mode', () => {
  const tall = getPipelineBoardLayout(1400, 752, false);
  const short = getPipelineBoardLayout(1400, 440, false);
  assert.ok(short.cardPadding < tall.cardPadding);
  assert.ok(short.cardGap < tall.cardGap);
  assert.equal(tall.cardGap, 6);
  assert.equal(short.cardGap, 4);
  assert.ok(short.headerPadding < tall.headerPadding);
  assert.equal(tall.headerPadding, 5);
  assert.equal(short.headerPadding, 3);
  assert.equal(short.columnWidth, tall.columnWidth);
  assert.equal('fontSize' in short, false);
});

test('mobile keeps its touch spacing and ignores desktop compaction thresholds', () => {
  for (const [width, height] of [[342, 600], [280, 300]]) {
    const layout = getPipelineBoardLayout(width, height, true);
    assert.equal(layout.compact, false);
    assert.equal(layout.short, false);
    assert.equal(layout.cardPadding, 12);
    assert.equal(layout.cardGap, 6);
    assert.equal(layout.headerPadding, 5);
  }
});

test('unmeasured or exceptionally narrow boards preserve a readable horizontal-scroll fallback', () => {
  assert.equal(getPipelineBoardLayout(0, 0, false).columnWidth, 288);
  assert.equal(getPipelineBoardLayout(Number.NaN, Number.POSITIVE_INFINITY, false).columnWidth, 288);
  assert.equal(getPipelineBoardLayout(180, 400, false).columnWidth, 240);
});
