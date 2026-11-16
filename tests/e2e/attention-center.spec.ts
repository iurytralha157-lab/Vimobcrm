import { expect, test } from '@playwright/test'

import { signInAs } from './support/auth'

test.describe.serial('Regras de atenção e acesso à página inicial', () => {
  test('página inicial do corretor preserva o acesso aos atalhos', async ({ page }) => {
    await signInAs(page, 'user')
    await page.goto('/inicio')

    await expect(page.getByRole('textbox', { name: 'Pesquise no Vimob' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Seu foco agora' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Central de Atenção' })).toHaveCount(0)
  })

  test('link legado abre a página inicial', async ({ page }) => {
    await signInAs(page, 'user')
    await page.goto('/attention')

    await expect(page).toHaveURL(/\/inicio$/)
    await expect(page.getByRole('textbox', { name: 'Pesquise no Vimob' })).toBeVisible()
  })

  test('configurações gerais e do pipeline ficam dentro da Pipeline', async ({ page }) => {
    await signInAs(page, 'admin')
    await page.goto('/crm/pipelines')

    await expect(page.getByRole('heading', { name: 'Novos E2E' })).toBeVisible()
    await page.getByRole('button', { name: 'Configurar pipeline' }).click()
    await page.getByRole('menuitem', { name: 'Prioridades e atenção' }).click()

    const settings = page.getByRole('dialog', { name: 'Prioridades e atenção' })
    await expect(settings).toBeVisible()
    await expect(settings.getByText('Segurança da organização')).toBeVisible()
    await expect(settings.getByText('Regras de Pipeline E2E')).toBeVisible()
    await expect(settings.getByText('Regras de permanência continuam dentro de cada coluna.')).toBeVisible()
  })

  test('menu móvel e página inicial continuam acessíveis', async ({ page }) => {
    await signInAs(page, 'user')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/inicio')

    await expect(page.getByRole('region', { name: 'Seu foco agora' })).toHaveCount(0)
    const bottomNav = page.locator('nav.app-mobile-bottom-nav')
    await bottomNav.getByRole('button', { name: 'Mais' }).click()
    const menu = page.getByRole('dialog', { name: 'Menu principal' })
    await expect(menu.getByRole('link', { name: 'Central de Atenção' })).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
