import { expect, test, type Page } from '@playwright/test';

import { authenticatedAPIRequest, signInAs } from './support/auth';

type CreatedProperty = {
  data: { id: string; updated_at: string };
};

async function deletePropertyAtLatestVersion(page: Page, propertyID: string) {
  const current = await authenticatedAPIRequest(
    page,
    'GET',
    `/v1/properties/${propertyID}`,
  );
  if (current.status() === 404) return;
  const currentBody = await current.text();
  expect(current.ok(), currentBody).toBeTruthy();
  const property = (JSON.parse(currentBody) as CreatedProperty).data;
  const deleted = await authenticatedAPIRequest(
    page,
    'DELETE',
    `/v1/properties/${propertyID}`,
    { expected_updated_at: property.updated_at },
  );
  expect(deleted.ok(), await deleted.text()).toBeTruthy();
}

async function expectSuccessfulNavigation(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response, `document response for ${path}`).not.toBeNull();
  expect(response?.status(), `document status for ${path}`).toBeLessThan(400);
  await expect(page.getByText('Acesso nao disponivel')).toHaveCount(0);
}

test('administrador navega pelos catalogos e configuracoes de imoveis', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, 'admin');

  await expectSuccessfulNavigation(page, '/properties');
  await expect(page.getByRole('heading', { name: 'Imóveis', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Todos os imóveis' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await expectSuccessfulNavigation(page, '/properties/launches');
  await expect(
    page.getByRole('heading', { name: 'Imóveis em lançamento', level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Lançamentos' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await expectSuccessfulNavigation(page, '/properties/rentals');
  await expect(
    page.getByRole('heading', {
      name: 'Imóveis para locação e temporada',
      level: 1,
    }),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Aluguel' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await expectSuccessfulNavigation(page, '/properties/settings');
  await expect(
    page.getByRole('heading', { name: 'Configurações de imóveis', level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Configurações' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page.getByRole('heading', { name: 'Visualização do proprietário' }),
  ).toBeVisible();

  await expectSuccessfulNavigation(page, '/settings?tab=properties');
  await expect(page).toHaveURL(/\/properties\/settings$/);
});

test('todos agrega modalidades e os catalogos aplicam somente o preset esperado', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, 'admin');

  const suffix = Date.now().toString(36);
  const launchTitle = `Lancamento navegacao E2E ${suffix}`;
  const rentalTitle = `Locacao navegacao E2E ${suffix}`;
  const createdIDs: string[] = [];

  try {
    for (const [title, dealType] of [
      [launchTitle, 'Lançamento'],
      [rentalTitle, 'Aluguel'],
    ] as const) {
      const response = await authenticatedAPIRequest(page, 'POST', '/v1/properties', {
        title,
        tipo_de_imovel: 'Apartamento',
        tipo_de_negocio: dealType,
      });
      const body = await response.text();
      expect(response.ok(), body).toBeTruthy();
      createdIDs.push((JSON.parse(body) as CreatedProperty).data.id);
    }

    await expectSuccessfulNavigation(page, '/properties');
    await expect(page.getByText(launchTitle, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(rentalTitle, { exact: true }).first()).toBeVisible();

    await expectSuccessfulNavigation(page, '/properties/launches');
    await expect(page.getByText(launchTitle, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(rentalTitle, { exact: true })).toHaveCount(0);

    await expectSuccessfulNavigation(page, '/properties/rentals');
    await expect(page.getByText(rentalTitle, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(launchTitle, { exact: true })).toHaveCount(0);
  } finally {
    for (const propertyID of createdIDs) {
      await deletePropertyAtLatestVersion(page, propertyID).catch(() => undefined);
    }
  }
});
