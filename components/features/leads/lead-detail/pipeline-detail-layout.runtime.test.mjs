import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Geometry fixture using the actual dialog/grid/column classes and compiled
// application CSS. It does not mount lead hooks, Radix behavior or the full UI.
// All content is synthetic and all browser network requests are blocked.
const require = createRequire(import.meta.url);
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const { transform } = require('lightningcss');
const { twMerge } = require('tailwind-merge');
const ts = require('typescript');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const artifacts = resolve(process.env.PIPELINE_VISUAL_ARTIFACT_DIR || join(tmpdir(), 'vimob-pipeline-detail-visual-artifacts'));
let browser, baseCSS, moduleCSS, moduleClasses, dialogClasses, primitiveClasses, gridClasses, mobileTagClasses, desktopTagClasses, tagCountClasses;

function productionBaseClass(source, prefix) {
  const parsed = ts.createSourceFile('fixture-source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  const findLiteral = node => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.startsWith(`${prefix} `)) matches.push(node.text);
    ts.forEachChild(node, findLiteral);
  };
  const visit = node => {
    if (ts.isJsxAttribute(node) && node.name.getText(parsed) === 'className' && node.initializer) findLiteral(node.initializer);
    else ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.equal(matches.length, 1, `expected exactly one production className base for ${prefix}`);
  return matches[0];
}

before(async () => {
  const [source, primitive, globals, moduleSource] = await Promise.all([
    readFile(join(repository, 'components/features/leads/LeadDetailDialog.tsx'), 'utf8'),
    readFile(join(repository, 'components/ui/dialog.tsx'), 'utf8'),
    readFile(join(repository, 'app/globals.css'), 'utf8'),
    readFile(join(repository, 'components/features/leads/lead-detail/PipelineLeadDetail.module.css')),
  ]);
  dialogClasses = productionBaseClass(source, 'lead-detail-dialog-content');
  primitiveClasses = productionBaseClass(primitive, 'vimob-dialog-content');
  gridClasses = productionBaseClass(source, 'lead-detail-v2-grid');
  mobileTagClasses = productionBaseClass(source, 'flex h-5 items-center gap-1 rounded-[4px]');
  desktopTagClasses = productionBaseClass(source, 'flex h-6 items-center gap-1 rounded-[5px]');
  tagCountClasses = productionBaseClass(source, 'h-5 rounded-[4px] border-0 px-1.5');
  assert.ok(dialogClasses && primitiveClasses && gridClasses, 'fixture must use the current production class strings');
  const sources = ['components/features/leads/LeadDetailDialog.tsx', 'components/features/leads/LeadUnifiedThread.tsx', 'components/ui']
    .map(path => `@source "${join(repository, path).replaceAll('\\', '/')}";`).join('\n');
  baseCSS = (await postcss([tailwind({ base: repository })]).process(
    `${globals.replace('@import "tailwindcss";', '@import "tailwindcss" source(none);')}\n${sources}`,
    { from: join(repository, 'app/globals.css') },
  )).css;
  const compiled = transform({
    filename: join(repository, 'components/features/leads/lead-detail/PipelineLeadDetail.module.css'),
    code: moduleSource, cssModules: true,
  });
  moduleCSS = compiled.code.toString();
  moduleClasses = Object.fromEntries(Object.entries(compiled.exports).map(([key, value]) => [key, value.name]));
  browser = await chromium.launch({ headless: true });
}, { timeout: 90_000 });

after(async () => { await browser?.close(); });

function fixture(pipeline) {
  const columnScroll = `lead-detail-v2-scroll h-full overflow-y-auto p-4 ${pipeline ? moduleClasses.columnScroll : ''}`;
  const dialog = twMerge(primitiveClasses, dialogClasses, pipeline ? moduleClasses.dialog : '');
  const tags = [mobileTagClasses, desktopTagClasses, twMerge('text-xs font-semibold', tagCountClasses, pipeline ? 'font-light' : '')].map((classes, index) => `<div data-tag-typography class="${classes} ${pipeline ? moduleClasses.tag : ''}"><span>Tag sintética ${index + 1}</span></div>`).join('');
  const rows = Array.from({ length: 12 }, (_, index) => `<div class="flex min-w-0 items-start justify-between gap-3 text-xs leading-4"><span class="min-w-0">Campo ${index + 1}</span><span class="min-w-0 max-w-[60%] break-words text-right [overflow-wrap:anywhere]">Texto sintético longo para verificar quebra de linha sem expansão do bloco</span></div>`).join('');
  const tasks = Array.from({ length: 14 }, (_, index) => `<div class="rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2"><span class="text-[11px]" data-font="11">Tarefa sintética ${index + 1}</span><p class="text-[10px]" data-font="10">Próxima ação e observação do atendimento</p></div>`).join('');
  // Current LeadUnifiedThread uses 11px event text and 10px timestamps.
  // The old 10.5px history marker no longer occurs in that production source.
  const events = Array.from({ length: 16 }, (_, index) => `<div class="rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2"><p class="text-[11px]" data-font="history">Evento sintético ${index + 1}</p><p class="text-xs break-words [overflow-wrap:anywhere]">Histórico de exemplo com conteúdo longo para confirmar a contenção de cada coluna.</p><span class="text-[10px]" data-font="history-time">12/10 · 10:30</span></div>`).join('');
  return `<html><body><div class="fixed inset-0 bg-[var(--app-background)]"></div>
    <div role="dialog" data-testid="detail" data-lead-detail-variant="${pipeline ? 'pipeline' : 'default'}" class="${dialog}" style="border:none;outline:none">
      <div class="lead-detail-dialog lead-detail-v2 flex h-full max-h-full flex-col bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]">
        <div class="border-b border-transparent bg-[var(--app-surface-solid)] px-4 pt-4"><div class="w-full" style="overflow-x:auto"><nav class="lead-stage-rail flex min-w-max items-center pb-3" style="--lead-stage-step-size:2rem;--lead-stage-step-font-size:0.75rem;--lead-stage-step-gap:0.375rem">${Array.from({ length: 12 }, (_, index) => `<button class="lead-stage-step relative flex shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)]">${index + 1}</button>`).join('')}</nav></div></div>
        <div class="${gridClasses}" data-testid="grid">
          <aside class="lead-detail-v2-column border-r border-[var(--app-border)]"><div class="${columnScroll}" data-scroll="info"><section class="space-y-3">
            <h2 class="truncate text-[14px] font-normal leading-tight">Lead sintético com um nome extenso</h2>
            <div class="flex flex-wrap gap-1.5">${tags}</div>
            <button class="h-8 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs">Responsável sintético</button>
            <div class="rounded-[8px] bg-[var(--app-surface-soft)] p-3"><h3 class="text-[12px]">Dados do contato</h3>${rows}<button class="lead-detail-subtle-action h-7 rounded-[5px] px-2 text-[10px]" data-font="action">Editar</button></div>
            <div class="rounded-[8px] bg-[var(--app-surface-soft)] p-3"><h3 class="text-[12px]">Documentação</h3><input aria-label="Nome sintético" class="h-8 w-full rounded-[6px] text-xs" value="Nome sintético" /></div>
          </section></div></aside>
          <main class="lead-detail-v2-column"><div class="${columnScroll}" data-scroll="work"><div class="space-y-4">
            <section class="lead-agenda-card rounded-[8px] bg-[var(--app-surface-soft)] p-3"><h3 class="text-[12px]">Agenda</h3><p class="text-[10px]" data-font="summary">2 visitas/reuniões em aberto</p><button class="lead-detail-primary-action h-8 rounded-[6px] px-2.5" data-font="primary">Agendar</button><div class="text-[10.5px]" data-font="date">12/10 10:00–10:30</div></section>
            <section class="rounded-[8px] bg-[var(--app-surface-soft)] p-3"><h3 class="text-[12px]">Cadência</h3><div class="space-y-1.5">${tasks}</div></section>
            <section class="rounded-[8px] bg-[var(--app-surface-soft)] p-3"><textarea aria-label="Feedback sintético" class="min-h-[74px] w-full resize-none rounded-[6px] text-xs">Conteúdo sintético</textarea><button class="lead-detail-primary-action h-8 rounded-[6px] px-3">Registrar feedback</button></section>
          </div></div></main>
          <aside class="lead-detail-v2-column border-l border-[var(--app-border)]"><section class="lead-thread-panel flex h-full min-h-0 flex-col bg-transparent p-3"><div class="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)]"><div class="lead-thread-scroll flex-1 space-y-3 overflow-y-auto px-1 pb-3 pt-3" data-scroll="history">${events}</div></div></section></aside>
        </div>
      </div>
    </div></body></html>`;
}

async function open(width, height, { pipeline = true, includeModule = true } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.setContent(fixture(pipeline));
  await page.addStyleTag({ content: baseCSS + (includeModule ? moduleCSS : '') });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  // The real dialog has duration-200. Inserting styles into a geometry fixture
  // can start transitions from the unstyled DOM; measure their final position.
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))));
  return page;
}

async function geometry(page) {
  return page.locator('[data-testid="detail"]').evaluate(dialog => {
    const grid = dialog.querySelector('[data-testid="grid"]');
    const rect = element => { const { x, y, width, height, right, bottom } = element.getBoundingClientRect(); return { x, y, width, height, right, bottom }; };
    return {
      dialog: rect(dialog), grid: rect(grid), columns: [...grid.children].map(rect),
      gridOverflow: grid.scrollWidth > grid.clientWidth + 1,
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      scrolls: [...dialog.querySelectorAll('[data-scroll]')].map(element => ({
        horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
        verticalScroll: element.scrollHeight > element.clientHeight,
        scrollbar: getComputedStyle(element).scrollbarWidth,
        padding: getComputedStyle(element).paddingTop,
      })),
      fonts: [...dialog.querySelectorAll('[data-font]')].map(element => ({ role: element.dataset.font, fontSize: getComputedStyle(element).fontSize, history: Boolean(element.closest('.lead-thread-panel')) })),
      tags: [...dialog.querySelectorAll('[data-tag-typography]')].map(element => ({ fontSize: getComputedStyle(element).fontSize, fontWeight: getComputedStyle(element).fontWeight })),
    };
  });
}

for (const [width, height] of [[1024, 600], [1279, 720], [1280, 720], [1366, 768], [1440, 900], [1920, 1080]]) {
  test(`compiled Pipeline popup CSS contains the fixture at ${width}x${height}`, async () => {
    const baselinePage = await open(width, height, { includeModule: false });
    let baselineHistoryFonts;
    try { baselineHistoryFonts = (await geometry(baselinePage)).fonts.filter(font => font.history); }
    finally { await baselinePage.close(); }
    const page = await open(width, height);
    try {
      const measured = await geometry(page);
      const evidence = JSON.stringify(measured);
      if (width === 1280) {
        await mkdir(artifacts, { recursive: true });
        await page.screenshot({ path: join(artifacts, 'detail-1280x720.png') });
      }
      assert.ok(measured.dialog.x >= 23 && measured.dialog.y >= 23, evidence);
      assert.ok(measured.dialog.right <= width - 23 && measured.dialog.bottom <= height - 23, evidence);
      assert.ok(measured.columns[0].width >= 219 && measured.columns[1].width >= 279 && measured.columns[2].width >= 279);
      assert.ok(measured.columns.at(-1).right <= measured.grid.right + 1);
      assert.equal(measured.gridOverflow, false);
      assert.equal(measured.documentOverflow, false);
      assert.ok(measured.scrolls.every(scroll => !scroll.horizontalOverflow && scroll.scrollbar === 'thin'), evidence);
      assert.ok(measured.scrolls[1].verticalScroll && measured.scrolls[2].verticalScroll, evidence);
      if (height <= 720) assert.equal(measured.scrolls[0].verticalScroll, true, evidence);
      const regularFonts = measured.fonts.filter(font => !font.history);
      assert.ok(regularFonts.length > 3 && regularFonts.every(font => font.fontSize === '12px'));
      const historyFonts = measured.fonts.filter(font => font.history);
      assert.deepEqual(historyFonts, baselineHistoryFonts, 'the module must preserve each native history role and its cardinality');
      assert.deepEqual(historyFonts, Array.from({ length: 16 }, () => [
        { role: 'history', fontSize: '11px', history: true },
        { role: 'history-time', fontSize: '10px', history: true },
      ]).flat());
      assert.deepEqual(measured.tags, Array.from({ length: 3 }, () => ({ fontSize: '10px', fontWeight: '300' })));
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });
}

test('the center track does not shrink at the previous XL breakpoint', async () => {
  const beforePage = await open(1279, 720);
  const afterPage = await open(1280, 720);
  try {
    const before = await geometry(beforePage);
    const after = await geometry(afterPage);
    assert.ok(after.columns[1].width >= before.columns[1].width - 0.5);
    assert.ok(Math.abs(after.columns[1].width - before.columns[1].width) <= 1);
  } finally { await beforePage.close(); await afterPage.close(); }
});

test('the default variant retains its original geometry, fonts and scrollbars with the module loaded', async () => {
  const baseline = await open(1280, 720, { pipeline: false, includeModule: false });
  const moduleLoaded = await open(1280, 720, { pipeline: false });
  try {
    assert.deepEqual(await geometry(moduleLoaded), await geometry(baseline));
  } finally { await baseline.close(); await moduleLoaded.close(); }
});
