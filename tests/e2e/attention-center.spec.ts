import { expect, test } from '@playwright/test'

import { HOME_PAGE_SECTIONS } from '../../components/features/home/home-catalog'
import { signInAs } from './support/auth'

test.describe.serial('Prioridades e atenção integradas', () => {
  test('corretor encontra as atenções na página inicial sem item dedicado no menu', async ({ page }) => {
    await signInAs(page, 'user')
    await page.goto('/inicio')

    const focus = page.getByRole('region', { name: 'Seu foco agora' })
    if (!HOME_PAGE_SECTIONS.focus) {
      await expect(focus).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Central de Atenção' })).toHaveCount(0)
      return
    }

    await expect(focus).toBeVisible()
    await expect(focus.getByText('Prioridades e atenções que precisam da sua ação, ordenadas por urgência.')).toBeVisible()
    await expect(focus.getByText('Contato efetivo', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Central de Atenção' })).toHaveCount(0)
  })

  test('link legado leva diretamente ao foco da página inicial', async ({ page }) => {
    await signInAs(page, 'user')
    await page.goto('/attention')

    await expect(page).toHaveURL(HOME_PAGE_SECTIONS.focus ? /\/inicio#home-focus$/ : /\/inicio$/)
    await expect(page.getByRole('region', { name: 'Seu foco agora' })).toHaveCount(HOME_PAGE_SECTIONS.focus ? 1 : 0)
  })

  test('gestor alterna entre o próprio foco, equipe e organização', async ({ page }) => {
    test.skip(!HOME_PAGE_SECTIONS.focus, 'Bloco de foco temporariamente desativado na página inicial.')

    await signInAs(page, 'admin')
    await page.goto('/inicio')

    const focus = page.getByRole('region', { name: 'Seu foco agora' })
    await expect(focus.getByRole('button', { name: 'Meu foco' })).toHaveAttribute('aria-pressed', 'true')
    await expect(focus.getByRole('button', { name: 'Equipe' })).toBeVisible()
    await focus.getByRole('button', { name: 'Organização' }).click()
    await expect(focus.getByRole('button', { name: 'Organização' })).toHaveAttribute('aria-pressed', 'true')
    await expect(focus.getByText('Lead Externo E2E').first()).toBeVisible()
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

  test('mobile mantém o foco integrado sem overflow e sem atalho para a página antiga', async ({ page }) => {
    await signInAs(page, 'user')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/inicio')

    await expect(page.getByRole('region', { name: 'Seu foco agora' })).toHaveCount(HOME_PAGE_SECTIONS.focus ? 1 : 0)
    const bottomNav = page.locator('nav.app-mobile-bottom-nav')
    await bottomNav.getByRole('button', { name: 'Mais' }).click()
    const menu = page.getByRole('dialog', { name: 'Menu principal' })
    await expect(menu.getByRole('link', { name: 'Central de Atenção' })).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
