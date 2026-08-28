import { expect, type Page, type TestInfo } from '@playwright/test';

import protocol from '@/tests/e2e/coverage/protocol.json';

export const E2E_INVENTORY_DIGEST_SHA256 =
  'd70d8932aac65155d36e9c39e656a281d312114dc0c45efa2989c95d5ae2bc6c';

export type RouteViewportClaim = {
  claimId: `claim:${string}`;
  category: 'routeViewport';
  inventoryId: `route:${string}`;
  route: `/${string}`;
  viewport: 'desktop' | 'mobile';
  ready: {
    role: 'heading';
    name: string;
  };
};

type VerifyRouteViewportClaimOptions = {
  page: Page;
  testInfo: TestInfo;
  caseId: string;
  claim: RouteViewportClaim;
};

function attachmentBody(value: object) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function normalizedRoutePath(urlOrPath: string) {
  const pathname = new URL(urlOrPath, 'http://e2e.local').pathname;
  return pathname.replace(/\/+$/, '') || '/';
}

export async function verifyRouteViewportClaim({
  page,
  testInfo,
  caseId,
  claim,
}: VerifyRouteViewportClaimOptions) {
  await testInfo.attach(`${protocol.attemptAttachmentPrefix}${claim.claimId}`, {
    body: attachmentBody({
      schemaVersion: protocol.schemaVersion,
      kind: protocol.attemptKind,
      inventoryDigestSha256: E2E_INVENTORY_DIGEST_SHA256,
      caseId,
      claimId: claim.claimId,
    }),
    contentType: protocol.attemptContentType,
  });

  const response = await page.goto(claim.route);
  expect(response?.status(), `${claim.route}: status HTTP`).toBe(200);
  expect(response?.request().redirectedFrom(), `${claim.route}: sem redirect`).toBeNull();

  const expectedPath = normalizedRoutePath(claim.route);
  const responsePath = normalizedRoutePath(response?.url() ?? '');
  const finalPath = normalizedRoutePath(page.url());
  expect(responsePath, `${claim.route}: URL final da resposta`).toBe(expectedPath);
  expect(finalPath, `${claim.route}: URL final da página`).toBe(expectedPath);

  const readyLandmark = page.getByRole(claim.ready.role, {
    name: claim.ready.name,
    exact: true,
  });
  await expect(readyLandmark, `${claim.route}: landmark de prontidão`).toBeVisible();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(readyLandmark, `${claim.route}: landmark estável`).toBeVisible();

  const body = page.locator('body');
  await expect(body, `${claim.route}: body visível`).toBeVisible();

  const layout = await page.evaluate(() => ({
    bodyTextLength: document.body.innerText.trim().length,
    noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }));
  expect(layout.bodyTextLength, `${claim.route}: body não vazio`).toBeGreaterThan(0);
  expect(layout.noHorizontalOverflow, `${claim.route}: sem overflow horizontal`).toBe(true);

  if (claim.viewport === 'desktop') {
    expect(layout.viewportWidth, `${claim.route}: viewport desktop`).toBeGreaterThanOrEqual(1024);
  } else {
    expect(layout.viewportWidth, `${claim.route}: viewport mobile`).toBeLessThan(768);
  }

  // Esta é a única escrita da prova: ocorre somente após status/URL sem redirect,
  // body visível e não vazio, e ausência de overflow terem sido comprovados.
  await testInfo.attach(`${protocol.proofAttachmentPrefix}${claim.claimId}`, {
    body: attachmentBody({
      schemaVersion: protocol.schemaVersion,
      kind: protocol.proofKind,
      inventoryDigestSha256: E2E_INVENTORY_DIGEST_SHA256,
      caseId,
      claimId: claim.claimId,
      category: claim.category,
      inventoryId: claim.inventoryId,
      route: claim.route,
      viewport: claim.viewport,
      ready: claim.ready,
      evidence: {
        responseStatus: 200,
        bodyVisible: true,
        bodyTextLength: layout.bodyTextLength,
        noHorizontalOverflow: true,
        redirected: false,
        responsePath,
        finalPath,
        readyLandmarkVisible: true,
        stabilityFrames: 2,
        viewportWidth: layout.viewportWidth,
        viewportHeight: layout.viewportHeight,
      },
    }),
    contentType: protocol.proofContentType,
  });
}
