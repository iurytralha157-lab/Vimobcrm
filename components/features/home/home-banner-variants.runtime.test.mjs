import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(root, 'package.json'));
const { chromium, expect } = require('@playwright/test');
const origin = 'https://home-banner.example.test';
const images = {
  'desktop-light': [1200, 160],
  'mobile-light': [400, 240],
  'desktop-dark': [1200, 200],
  'mobile-dark': [400, 300],
};
const imageUrl = (variant) => `${origin}/${variant}.svg`;
const publication = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Banner de campanha QA', body: 'Conteúdo editorial QA',
  ctaLabel: 'Ajuda', ctaHref: '/suporte', accent: 'orange', cardSize: 'wide', displayOrder: 0,
  imageUrl: imageUrl('desktop-light'), mobileImageUrl: imageUrl('mobile-light'),
  darkImageUrl: imageUrl('desktop-dark'), darkMobileImageUrl: imageUrl('mobile-dark'),
};
let directory, browser, bundle, css;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-home-banner-variants-'));
  const entry = path.join(directory, 'fixture.tsx');
  const loader = path.join(directory, 'loader.cjs');
  await writeFile(entry, `import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, useTheme } from 'next-themes';
import { HomePublicationCarousel } from '@/components/features/home/HomePublicationCarousel';
function Fixture() {
  const [publication, setPublication] = useState(window.homeBannerQA.publication);
  const { setTheme, resolvedTheme } = useTheme();
  useEffect(() => {
    Object.assign(window.homeBannerQA, { setPublication, setTheme, ready: true });
  }, [setTheme]);
  return <main><output data-testid="theme">{resolvedTheme}</output>
    <HomePublicationCarousel publications={[publication]} isLoading={false} />
  </main>;
}
createRoot(document.getElementById('app')).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
    <Fixture />
  </ThemeProvider>
);`);
  await writeFile(loader, `const ts = require(${JSON.stringify(require.resolve('typescript'))});
module.exports = source => ts.transpileModule(source, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
} }).outputText;`);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: 'development', target: 'web', devtool: false, entry,
      output: { path: directory, filename: 'fixture.js' },
      resolve: {
        extensions: ['.tsx', '.ts', '.js'],
        modules: [path.join(root, 'node_modules'), 'node_modules'],
        alias: { '@': root },
      },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
    });
    compiler.run((error, stats) => compiler.close(() =>
      error || stats.hasErrors()
        ? reject(error || Error(stats.toString({ all: false, errors: true })))
        : resolve()));
  });
  bundle = await readFile(path.join(directory, 'fixture.js'), 'utf8');
  const globals = (await readFile(path.join(root, 'app/globals.css'), 'utf8'))
    .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const sources = ['components/features/home/HomePublicationCarousel.tsx', 'components/ui']
    .map((source) => `@source "${path.join(root, source).replaceAll('\\', '/')}";`).join('\n');
  css = (await require('postcss')([require('@tailwindcss/postcss')({ base: root })])
    .process(`${globals}\n${sources}`, { from: path.join(root, 'app/home-banner-fixture.css') })).css;
  browser = await chromium.launch({ headless: true });
}, { timeout: 180_000 });

after(async () => {
  await browser?.close();
  if (directory) {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert.ok(path.basename(target).startsWith('vimob-home-banner-variants-'));
    await rm(target, { recursive: true, force: true });
  }
});

async function openFixture({ width = 1200, theme = 'light', colorScheme = 'light', record = publication } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<html><body><div id="app"></div></body></html>' });
    const variant = url.pathname.slice(1, -4);
    const dimensions = images[variant];
    if (!dimensions) return route.abort();
    requests.push(variant);
    const [imageWidth, imageHeight] = dimensions;
    const dark = variant.endsWith('dark');
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}"><rect width="100%" height="100%" fill="${dark ? '#171c28' : '#fff1e8'}"/><rect width="8" height="100%" fill="#ff4529"/><text x="30" y="50" font-family="Arial" font-size="24" fill="${dark ? '#fff' : '#171c28'}">Vimob · Banner QA</text><text x="30" y="88" font-family="Arial" font-size="20" fill="#ff4529">${variant}</text></svg>` });
  });
  await page.goto(origin);
  await page.evaluate(({ theme, record }) => {
    localStorage.setItem('theme', theme);
    globalThis.process = { env: { NODE_ENV: 'test' } };
    window.homeBannerQA = { publication: record };
  }, { theme, record });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await expect.poll(() => page.evaluate(() => window.homeBannerQA.ready)).toBe(true);
  return { page, context, requests, errors };
}

async function expectImage(page, variant) {
  const image = page.getByRole('img', { name: publication.title, exact: true });
  await expect.poll(() => image.evaluate((element) => element.currentSrc)).toBe(imageUrl(variant));
  await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  const [naturalWidth, naturalHeight] = images[variant];
  const geometry = await image.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const article = element.closest('article');
    const viewport = article?.parentElement?.parentElement?.parentElement?.parentElement;
    return {
      width: rect.width, height: rect.height,
      naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight,
      objectFit: getComputedStyle(element).objectFit,
      articleHeight: article?.getBoundingClientRect().height,
      viewportHeight: viewport?.getBoundingClientRect().height,
    };
  });
  assert.equal(geometry.naturalWidth, naturalWidth);
  assert.equal(geometry.naturalHeight, naturalHeight);
  assert.ok(Math.abs(geometry.height - geometry.width * naturalHeight / naturalWidth) < 1, JSON.stringify(geometry));
  assert.equal(geometry.objectFit, 'contain');
  assert.ok(Math.abs(geometry.articleHeight - geometry.height) < 1, JSON.stringify(geometry));
  await expect.poll(() => image.evaluate((element) => {
    const article = element.closest('article');
    const viewport = article?.parentElement?.parentElement?.parentElement?.parentElement;
    return Math.abs(viewport.getBoundingClientRect().height - article.getBoundingClientRect().height);
  })).toBeLessThan(1);
  await expect(image.locator('xpath=ancestor::a')).toHaveCount(0);
  await expect(page.getByText(publication.body, { exact: true })).toHaveCount(0);
}

for (const [theme, width, variant] of [
  ['light', 1200, 'desktop-light'], ['light', 390, 'mobile-light'],
  ['dark', 1200, 'desktop-dark'], ['dark', 390, 'mobile-dark'],
]) {
  test(`${theme} at ${width}px loads only the matching banner with natural proportions`, async () => {
    const state = await openFixture({ theme, width });
    try {
      await expectImage(state.page, variant);
      assert.deepEqual([...new Set(state.requests)], [variant]);
      assert.deepEqual(state.errors, []);
      if (process.env.HOME_BANNER_SCREENSHOTS) {
        const destination = path.join(root, 'outputs/home-banner-variants');
        await mkdir(destination, { recursive: true });
        await state.page.screenshot({ path: path.join(destination, `${variant}.png`), fullPage: true });
      }
    } finally { await state.context.close(); }
  });
}

test('theme changes and the 767/768px breakpoint update the banner without reloading', async () => {
  const state = await openFixture({ width: 768 });
  try {
    await expectImage(state.page, 'desktop-light');
    await state.page.setViewportSize({ width: 767, height: 900 });
    await expectImage(state.page, 'mobile-light');
    await state.page.evaluate(() => window.homeBannerQA.setTheme('dark'));
    await expectImage(state.page, 'mobile-dark');
    await state.page.setViewportSize({ width: 768, height: 900 });
    await expectImage(state.page, 'desktop-dark');
    await state.page.evaluate(() => window.homeBannerQA.setTheme('light'));
    await expectImage(state.page, 'desktop-light');
    assert.deepEqual(state.errors, []);
  } finally { await state.context.close(); }
});

test('system theme follows operating-system changes while an explicit theme takes priority', async () => {
  const state = await openFixture({ theme: 'system', colorScheme: 'dark', width: 390 });
  try {
    await expectImage(state.page, 'mobile-dark');
    await state.page.emulateMedia({ colorScheme: 'light' });
    await expectImage(state.page, 'mobile-light');
    await state.page.evaluate(() => window.homeBannerQA.setTheme('dark'));
    await expectImage(state.page, 'mobile-dark');
    await state.page.emulateMedia({ colorScheme: 'dark' });
    await state.page.emulateMedia({ colorScheme: 'light' });
    await expectImage(state.page, 'mobile-dark');
    assert.deepEqual(state.errors, []);
  } finally { await state.context.close(); }
});

test('legacy banners and partially configured variants retain an image in either theme and viewport', async () => {
  const state = await openFixture({ theme: 'dark', width: 390,
    record: { ...publication, darkImageUrl: null, darkMobileImageUrl: null } });
  try {
    await expectImage(state.page, 'mobile-light');
    await state.page.evaluate((record) => window.homeBannerQA.setPublication(record), {
      ...publication, mobileImageUrl: null, darkImageUrl: null, darkMobileImageUrl: null,
    });
    await expectImage(state.page, 'desktop-light');
    await state.page.setViewportSize({ width: 1200, height: 900 });
    await expectImage(state.page, 'desktop-light');
    await state.page.setViewportSize({ width: 390, height: 900 });
    await state.page.evaluate((record) => window.homeBannerQA.setPublication(record), {
      ...publication, darkMobileImageUrl: null,
    });
    await expectImage(state.page, 'mobile-light');
    await state.page.evaluate((record) => {
      window.homeBannerQA.setTheme('light');
      window.homeBannerQA.setPublication(record);
    }, { ...publication, imageUrl: null, mobileImageUrl: null, darkImageUrl: null });
    await expectImage(state.page, 'mobile-dark');
    await state.page.setViewportSize({ width: 1200, height: 900 });
    await expectImage(state.page, 'mobile-dark');
    assert.deepEqual(state.errors, []);
  } finally { await state.context.close(); }
});
