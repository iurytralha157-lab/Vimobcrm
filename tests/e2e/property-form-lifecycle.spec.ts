import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { E2E_USERS, type E2EUserKey } from './support/e2e-env';
import { authenticatedAPIRequest, signInAs } from './support/auth';

type UserListPayload = { data: Array<{ id: string; email: string }> };
type PropertyPayload = { data: { id: string; title: string; [key: string]: unknown } };

const image = {
  name: 'imovel-e2e.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZbQAAAABJRU5ErkJggg==', 'base64'),
};

async function selectOption(page: Page, trigger: ReturnType<Page['locator']>, option: string) {
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function openTab(page: Page, name: string, section: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.locator(section)).toBeVisible();
}

async function fillCreationForm(page: Page, title: string, suffix: string) {
  await openTab(page, 'Proprietário', '[data-tour="property-owner-section"]');
  await page.getByPlaceholder('Nome completo').fill(`Proprietario ${suffix}`);
  await page.getByPlaceholder('(00) 00000-0000').fill('(11) 99999-0000');

  await openTab(page, 'Dados do imóvel', '[data-tour="property-structure-section"]');
  await page.getByPlaceholder('Ex: Apartamento 3 quartos...').fill(title);
  const structureSelects = page.locator('[data-tour="property-structure-section"] button[role="combobox"]');
  await selectOption(page, structureSelects.nth(1), 'Apartamento');
  await page.getByPlaceholder('Código externo...').fill(`REF-${suffix}`);

  await openTab(page, 'Localização', '[data-tour="property-location-section"]');
  await page.getByPlaceholder('SP').fill('SP');
  await page.getByPlaceholder('Digite a cidade').fill('Sao Paulo');
  await page.getByPlaceholder('Digite o bairro').fill('Centro');
  await page.getByPlaceholder('Rua, Avenida...').fill('Rua E2E');
  await page.getByPlaceholder('123').fill('150');
  await page.getByPlaceholder('Apto, bloco...').fill('Apto 12');
  await page.getByPlaceholder('Ex: QD 12').fill('QD 3');
  await page.getByPlaceholder('Ex: LT 08').fill('LT 9');

  await openTab(page, 'Valores', '[data-tour="property-values-section"]');
  const currencies = page.locator('[data-tour="property-values-section"] input[inputmode="decimal"]');
  const values = ['1.500,80', '850,45', '2.340,99', '125,10', '78,35', '300,75', '1.420,60'];
  await expect(currencies).toHaveCount(values.length);
  for (let index = 0; index < values.length; index += 1) await currencies.nth(index).fill(values[index]);

  await openTab(page, 'Características', '[data-tour="property-characteristics-section"]');
  const characteristicSelects = page.locator('[data-tour="property-characteristics-section"] button[role="combobox"]');
  await selectOption(page, characteristicSelects.nth(0), '2');
  await page.getByPlaceholder('120,5').fill('84,50');
  await page.getByPlaceholder('150,5').fill('96,75');
  await page.getByPlaceholder('ZR-1, ZC-2...').fill('ZR-E2E');
  await page.getByPlaceholder('Observações internas...').fill(`Interno ${suffix}`);

  await page.getByRole('button', { name: 'Extras', exact: true }).click();
  await expect(page.getByText('Detalhes Extras do Imóvel', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Piscina', exact: true }).click();
  await page.getByRole('button', { name: 'Escolas', exact: true }).click();

  await openTab(page, 'Mídia e descrições', '[data-tour="property-media-section"]');
  const fileInputs = page.locator('[data-tour="property-media-section"] input[type="file"]');
  await expect(fileInputs).toHaveCount(2);
  await fileInputs.nth(0).setInputFiles(image);
  await expect(page.getByAltText('Imagem principal')).toBeVisible();
  await fileInputs.nth(1).setInputFiles(image);
  await expect(page.getByAltText('Foto 1')).toBeVisible();
  await page.getByPlaceholder('https://youtube.com/watch?v=...').fill('https://youtube.com/watch?v=e2e');
  await page.getByPlaceholder('Observações e descrição usadas dentro do CRM...').fill(`Descricao interna ${suffix}`);
  await page.getByPlaceholder('Texto comercial que será exibido no site público...').fill(`Descricao publica ${suffix}`);

  await openTab(page, 'Publicação', '[data-tour="property-publication-section"]');
  const publicationSwitches = page.locator('[data-tour="property-publication-section"] button[role="switch"]');
  await publicationSwitches.nth(1).click();
  await publicationSwitches.nth(3).click();

  await openTab(page, 'Comissões', '[data-tour="property-commissions-section"]');
  await page.getByPlaceholder('5').fill('5.5');
  await page.getByPlaceholder('Condições especiais...').fill(`Comissao ${suffix}`);

  await openTab(page, 'Confidencial', '[data-tour="property-confidential-section"]');
  await page.getByPlaceholder('Código IPTU').fill(`IPTU-${suffix}`);
  await page.getByPlaceholder('Matrícula').fill(`MAT-${suffix}`);
  const confidentialCodes = page.locator('[data-tour="property-confidential-section"] input[placeholder="Código"]');
  await confidentialCodes.nth(0).fill(`ELE-${suffix}`);
  await confidentialCodes.nth(1).fill(`AGUA-${suffix}`);
  await page.getByPlaceholder('Descrição').fill('Documentacao regular');
  await page.getByPlaceholder('Detalhes').fill('Aprovado');
  await page.getByPlaceholder('Observações sobre documentação...').fill(`Documentos ${suffix}`);
}

async function createPropertyThroughUI(page: Page, persona: string) {
  const suffix = `${persona}-${Date.now()}`;
  const title = `Imovel E2E ${suffix}`;
  await page.goto('/properties/new');
  await fillCreationForm(page, title, suffix);

  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/v1/properties' &&
    response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Cadastrar', exact: true }).click();
  const response = await responsePromise;
  const body = await response.text();
  expect(response.ok(), body).toBeTruthy();
  const property = (JSON.parse(body) as PropertyPayload).data;
  return { id: property.id, title, suffix };
}

async function editPropertyThroughUI(page: Page, property: { id: string; title: string; suffix: string }) {
  const editedTitle = `${property.title} Editado`;
  await page.goto(`/properties/${property.id}/edit`);

  await openTab(page, 'Proprietário', '[data-tour="property-owner-section"]');
  await page.getByPlaceholder('Nome completo').fill(`Proprietario editado ${property.suffix}`);
  await openTab(page, 'Dados do imóvel', '[data-tour="property-structure-section"]');
  await page.getByPlaceholder('Ex: Apartamento 3 quartos...').fill(editedTitle);
  await openTab(page, 'Localização', '[data-tour="property-location-section"]');
  await page.getByPlaceholder('Apto, bloco...').fill('Apto 99');
  await openTab(page, 'Valores', '[data-tour="property-values-section"]');
  await page.locator('[data-tour="property-values-section"] input[inputmode="decimal"]').nth(0).fill('9.876,54');
  await openTab(page, 'Características', '[data-tour="property-characteristics-section"]');
  await page.getByPlaceholder('Observações internas...').fill(`Interno editado ${property.suffix}`);
  await page.getByRole('button', { name: 'Extras', exact: true }).click();
  await page.getByRole('button', { name: 'Academia', exact: true }).click();
  await openTab(page, 'Mídia e descrições', '[data-tour="property-media-section"]');
  await page.getByPlaceholder('Texto comercial que será exibido no site público...').fill(`Publica editada ${property.suffix}`);
  await openTab(page, 'Publicação', '[data-tour="property-publication-section"]');
  await page.locator('[data-tour="property-publication-section"] button[role="switch"]').nth(2).click();
  await openTab(page, 'Comissões', '[data-tour="property-commissions-section"]');
  await page.getByPlaceholder('Condições especiais...').fill(`Comissao editada ${property.suffix}`);
  await openTab(page, 'Confidencial', '[data-tour="property-confidential-section"]');
  await page.getByPlaceholder('Observações sobre documentação...').fill(`Documentos editados ${property.suffix}`);

  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/v1/properties/${property.id}` &&
    response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  const response = await responsePromise;
  const body = await response.text();
  expect(response.ok(), body).toBeTruthy();
  const payload = (JSON.parse(body) as PropertyPayload).data;
  expect(payload.title).toBe(editedTitle);
  expect(payload.preco).toBe(9876.54);
  expect(payload.complemento).toBe('Apto 99');
}

async function findUserID(adminPage: Page, key: E2EUserKey) {
  const response = await authenticatedAPIRequest(adminPage, 'GET', '/v1/users');
  const payload = JSON.parse(await response.text()) as UserListPayload;
  return payload.data.find((user) => user.email === E2E_USERS[key].email)!.id;
}

async function setPropertyManage(adminPage: Page, userID: string, allowed: boolean) {
  const response = allowed
    ? await authenticatedAPIRequest(adminPage, 'PUT', `/v1/settings/users/${userID}/permissions`, {
        permissions: { property_manage: true },
      })
    : await authenticatedAPIRequest(adminPage, 'DELETE', `/v1/settings/users/${userID}/permissions`);
  const body = await response.text();
  expect(response.ok(), body).toBeTruthy();
}

async function runLifecycle(browser: Browser, key: E2EUserKey) {
  let actorContext: BrowserContext | undefined;
  let adminContext: BrowserContext | undefined;
  let userID = '';
  try {
    if (key !== 'admin') {
      actorContext = await browser.newContext();
      let actorPage = await actorContext.newPage();
      await signInAs(actorPage, key);
      await actorPage.goto('/properties/new');
      await expect(actorPage.getByText('Acesso nao disponivel')).toBeVisible();
      const denied = await authenticatedAPIRequest(actorPage, 'POST', '/v1/properties', { title: 'Negado E2E' });
      expect(denied.status()).toBe(403);
      await actorContext.close();
      actorContext = undefined;

      adminContext = await browser.newContext();
      const adminPage = await adminContext.newPage();
      await signInAs(adminPage, 'admin');
      userID = await findUserID(adminPage, key);
      await setPropertyManage(adminPage, userID, true);

      actorContext = await browser.newContext();
      actorPage = await actorContext.newPage();
      await signInAs(actorPage, key);
      const property = await createPropertyThroughUI(actorPage, key);
      const editPage = await actorContext.newPage();
      await editPropertyThroughUI(editPage, property);
      await editPage.close();
      const deleted = await authenticatedAPIRequest(actorPage, 'DELETE', `/v1/properties/${property.id}`);
      expect(deleted.ok(), await deleted.text()).toBeTruthy();
    } else {
      actorContext = await browser.newContext();
      const actorPage = await actorContext.newPage();
      await signInAs(actorPage, key);
      const property = await createPropertyThroughUI(actorPage, key);
      const editPage = await actorContext.newPage();
      await editPropertyThroughUI(editPage, property);
      await editPage.close();
      const deleted = await authenticatedAPIRequest(actorPage, 'DELETE', `/v1/properties/${property.id}`);
      expect(deleted.ok(), await deleted.text()).toBeTruthy();
    }
  } finally {
    if (userID && adminContext) {
      const pages = adminContext.pages();
      if (pages[0] && !pages[0].isClosed()) await setPropertyManage(pages[0], userID, false).catch(() => undefined);
    }
    await actorContext?.close();
    await adminContext?.close();
  }
}

test.describe.serial('cadastro e edicao completa de imoveis por perfil', () => {
  test.setTimeout(240_000);
  test('administrador percorre todas as abas, cria e edita', async ({ browser }) => runLifecycle(browser, 'admin'));
  test('lider bloqueado por padrao e funcional com property_manage', async ({ browser }) => runLifecycle(browser, 'leader'));
  test('usuario bloqueado por padrao e funcional com property_manage', async ({ browser }) => runLifecycle(browser, 'user'));
});
