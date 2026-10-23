import assert from 'node:assert/strict'
import test from 'node:test'

import { getSitePublicationState, getSitePublicationCardState, type SitePublication } from './site-publication-state'

const firstPublication = {
  id: '11111111-1111-4111-8111-111111111111',
  desired_state: 'published',
  observed_state: 'queued',
  published_version: null,
} as const

test('a live legacy announcement remains visible while its first canonical version is queued', () => {
  const state = getSitePublicationState(firstPublication, true, true)
  assert.equal(state.label, 'Publicado; atualização em processamento')
  assert.equal(state.canOpenPublicSite, true)
})

test('a published canonical version overrides a stale private legacy flag', () => {
  const state = getSitePublicationState({
    ...firstPublication,
    observed_state: 'published',
    published_version: 1,
  }, false, true)
  assert.equal(state.label, 'Publicado no site')
  assert.equal(state.canOpenPublicSite, true)
})

test('an existing published version remains identifiable during an update', () => {
  const state = getSitePublicationState({ ...firstPublication, published_version: 1 }, false, true)
  assert.equal(state.label, 'Publicado; atualização em processamento')
  assert.equal(state.canOpenPublicSite, true)
})

test('a requested withdrawal does not advertise a still processing version', () => {
  const state = getSitePublicationState({
    ...firstPublication,
    desired_state: 'unpublished',
    observed_state: 'unpublishing',
    published_version: 1,
  }, true, true)
  assert.equal(state.label, 'Retirada do site em processamento')
  assert.equal(state.canOpenPublicSite, false)
})

test('withdrawal of a legacy announcement stays distinguishable without a canonical published version', () => {
  const state = getSitePublicationState({ ...firstPublication, desired_state: 'unpublished', observed_state: 'queued' }, false, true)
  assert.equal(state.label, 'Retirada do site em processamento')
  assert.equal(state.canOpenPublicSite, false)
})

test('a pause request distinguishes the old live version from a completed pause', () => {
  const pending = getSitePublicationState({
    ...firstPublication,
    desired_state: 'paused',
    observed_state: 'pausing',
    published_version: 1,
  }, true, true)
  assert.equal(pending.label, 'Pausa em processamento')
  assert.equal(pending.canOpenPublicSite, false)

  const complete = getSitePublicationState({
    ...firstPublication,
    desired_state: 'paused',
    observed_state: 'paused',
    published_version: 1,
  }, true, true)
  assert.equal(complete.label, 'Publicação pausada')
})

test('a first publication failure is visible without exposing an unpublished property link', () => {
  const state = getSitePublicationState({ ...firstPublication, observed_state: 'error' }, false, true)
  assert.equal(state.label, 'Falha na publicação')
  assert.equal(state.canOpenPublicSite, false)
})

test('a failed canonical takeover preserves the existing legacy announcement', () => {
  const state = getSitePublicationState({ ...firstPublication, observed_state: 'error', legacy_visible: true }, false, true)
  assert.equal(state.label, 'Publicado; atualização falhou')
  assert.equal(state.canOpenPublicSite, true)
})

test('last-good publication is visibly degraded when delivery reports an error while observed remains published', () => {
  const state = getSitePublicationState({ ...firstPublication, observed_state: 'published', published_version: 1,
    last_error: { code: 'worker_timeout', message: 'Timeout' } }, false, true)
  assert.equal(state.label, 'Publicado; atualização falhou')
  assert.equal(state.tone, 'error')
  assert.equal(state.canOpenPublicSite, true)
})

test('the card distinguishes new publication, failed first delivery and a failed update', () => {
  assert.equal(getSitePublicationCardState(firstPublication, false).label, 'Publicando')
  assert.equal(getSitePublicationCardState({ ...firstPublication, observed_state: 'error' }, false).label, 'Falha na publicação')
  const update = getSitePublicationCardState({ ...firstPublication, observed_state: 'published', published_version: 1,
    last_error_code: 'worker_timeout' }, false)
  assert.equal(update.label, 'Falha na atualização')
  assert.equal(update.canOpenPublicSite, true)
})

test('legacy publication is used only after a complete canonical overview confirms no row', () => {
  assert.equal(getSitePublicationState(null, true, false).canOpenPublicSite, false)
  assert.equal(getSitePublicationState(null, true, true).canOpenPublicSite, true)
  assert.equal(getSitePublicationState(null, true, true).label, 'Publicado pelo fluxo anterior')
  assert.equal(getSitePublicationState(null, false, true).label, 'Fora do site')
})

test('a synthetic no-row overview recognizes legacy visibility independently of canonical desired state and module readiness', () => {
  const publication: SitePublication = { ...firstPublication, id: null, desired_state: 'unpublished', observed_state: 'draft', legacy_visible: true,
    checks: [{ code: 'site_module', label: 'Site', severity: 'error', resolved: false, message: 'Ative' }] }
  const state = getSitePublicationState(publication, false, true)
  assert.equal(state.label, 'Publicado pelo fluxo anterior')
  assert.equal(state.canOpenPublicSite, true)
  assert.equal(state.tone, 'success')
  assert.equal(getSitePublicationCardState(publication, false).label, 'Publicado')

  assert.equal(getSitePublicationState({ ...publication, id: firstPublication.id }, false, true).canOpenPublicSite, false)
  assert.equal(getSitePublicationState({ ...publication, id: firstPublication.id, desired_state: 'paused' }, false, true).canOpenPublicSite, false)
})

test('a no-row legacy overview never bypasses inactive site, unavailable status or denied commercialization', () => {
  for (const code of ['site_active', 'status', 'commercialization']) {
    const state = getSitePublicationState({ ...firstPublication, id: null, legacy_visible: true,
      checks: [{ code, label: code, severity: 'error', resolved: false, message: 'Indisponível' }] }, true, true)
    assert.equal(state.canOpenPublicSite, false, code)
    assert.equal(state.tone, 'neutral', code)
  }
})

test('a live unavailable status suppresses the site link despite a last published snapshot', () => {
  const state = getSitePublicationState({ ...firstPublication, observed_state: 'published', published_version: 1,
    checks: [{ code: 'status', label: 'Ativo', severity: 'error', resolved: false, message: 'Ative' }] }, true, true)
  assert.equal(state.label, 'Fora do site pelo status')
  assert.equal(state.canOpenPublicSite, false)
})

test('commercialization denial and catalog visibility override a formerly published version', () => {
  const publication = { ...firstPublication, observed_state: 'published', published_version: 1 } as const
  const denied = getSitePublicationState({ ...publication,
    checks: [{ code: 'commercialization', label: 'Autorizado', severity: 'error', resolved: false, message: 'Autorize' }] }, true, true)
  assert.equal(denied.canOpenPublicSite, false)
  assert.equal(denied.label, 'Comercialização não autorizada')
  assert.equal(getSitePublicationCardState({ ...publication, public_visible: false }, false).canOpenPublicSite, false)
})
