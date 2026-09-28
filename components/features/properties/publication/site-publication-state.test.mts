import assert from 'node:assert/strict'
import test from 'node:test'

import { getSitePublicationState } from './site-publication-state'

const firstPublication = {
  id: '11111111-1111-4111-8111-111111111111',
  desired_state: 'published',
  observed_state: 'queued',
  published_version: null,
} as const

test('the legacy flag cannot make a queued first publication appear public', () => {
  const state = getSitePublicationState(firstPublication, true, true)
  assert.equal(state.label, 'Publicação em processamento')
  assert.equal(state.canOpenPublicSite, false)
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

test('a first publication failure is visible without exposing a site link', () => {
  const state = getSitePublicationState({ ...firstPublication, observed_state: 'error' }, true, true)
  assert.equal(state.label, 'Falha na publicação')
  assert.equal(state.canOpenPublicSite, false)
})

test('legacy publication is used only after a complete canonical overview confirms no row', () => {
  assert.equal(getSitePublicationState(null, true, false).canOpenPublicSite, false)
  assert.equal(getSitePublicationState(null, true, true).canOpenPublicSite, true)
  assert.equal(getSitePublicationState(null, false, true).label, 'Fora do site')
})
