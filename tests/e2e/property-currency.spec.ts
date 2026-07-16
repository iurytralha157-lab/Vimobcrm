import { expect, test } from '@playwright/test';

import { signInAs } from './support/auth';

test('campos monetarios aceitam milhares e centavos', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/properties/new');
  await page.getByRole('button', { name: 'Valores', exact: true }).click();

  const fields = page.locator('[data-tour="property-values-section"] input[inputmode="decimal"]');
  await expect(fields).toHaveCount(7);

  const inputs = ['1.500,80', '850,45', '2.340,99', '125,10', '78,35', '300,75', '1.420,60'];

  for (let index = 0; index < inputs.length; index += 1) {
    await fields.nth(index).fill(inputs[index]);
  }

  await page.getByRole('button', { name: 'Valores', exact: true }).click();
  await expect.poll(() => fields.evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value)))
    .toEqual(inputs);

  await fields.nth(0).fill('9.876,54');
  await page.getByRole('button', { name: 'Valores', exact: true }).click();
  await expect(fields.nth(0)).toHaveValue('9.876,54');
});
