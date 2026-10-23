import assert from 'node:assert/strict'
import test from 'node:test'

import type { PropertyPublicationOverview } from '../validation/property-publications'

const autoPublicationPath = './property-auto-publication.ts'
const { planAutomaticSitePublication, requestAutomaticSitePublication, captureAutomaticSitePublicationAction,
  INITIAL_AUTOMATIC_SITE_PUBLICATION_ACTION } = await import(autoPublicationPath) as typeof import('./property-auto-publication')

function overview(overrides: Record<string, unknown> = {}, canManage = true): PropertyPublicationOverview {
  return {
    data: {
      property_id: '11111111-1111-4111-8111-111111111111',
      property_updated_at: '2026-09-28T12:00:00Z',
      publications: [{
        id: null,
        channel: 'site',
        channel_account_key: 'default',
        label: 'Site',
        available: true,
        desired_state: 'unpublished',
        observed_state: 'unpublished',
        readiness_state: 'ready',
        readiness_score: 100,
        checks: [],
        current_version: 0,
        published_version: null,
        is_outdated: false,
        public_url: null,
        preview: {},
        capabilities: { can_publish: true, can_unpublish: false, can_retry: false, can_preview: true },
        last_error: null,
        recent_jobs: [],
        ...overrides,
      }],
    },
    meta: { can_manage: canManage },
  } as PropertyPublicationOverview
}

test('save requests Site publication once with fresh canonical revisions', async () => {
  let publishes = 0
  const result = await requestAutomaticSitePublication('org', 'property', {
    getPublications: async () => overview(),
    publishSite: async (_org: string, _property: string, input, key) => {
      publishes += 1
      assert.deepEqual(input, {
        expected_property_updated_at: '2026-09-28T12:00:00Z',
        expected_publication_updated_at: null,
      })
      assert.equal(key, 'stable-key')
      return overview({ desired_state: 'published', observed_state: 'queued' })
    },
  }, 'stable-key')
  assert.deepEqual(result, { kind: 'requested', reasons: [] })
  assert.equal(publishes, 1)
})

test('missing bairro/cidade and inactive Site block command with specific reasons', async () => {
  const missingLocation = overview({
    readiness_state: 'blocked',
    checks: [{ code: 'location', label: 'Bairro, cidade e UF', severity: 'error', resolved: false, message: 'Informe bairro, cidade e UF.' }],
    capabilities: { can_publish: false, can_unpublish: false, can_retry: false, can_preview: true },
  })
  assert.deepEqual(planAutomaticSitePublication(missingLocation), {
    kind: 'blocked', reasons: ['Informe bairro, cidade e UF.'], fixableInForm: true,
  })
  const unavailable = overview({
    available: false,
    checks: [{ code: 'site_module', label: 'Módulo Site ativo', severity: 'error', resolved: false, message: 'Ative o módulo Site.' }],
  })
  assert.deepEqual(planAutomaticSitePublication(unavailable), {
    kind: 'blocked', reasons: ['Ative o módulo Site.'], fixableInForm: false,
  })
})

test('already published or queued Site needs no second command', async () => {
  const published = overview({
    id: '22222222-2222-4222-8222-222222222222',
    desired_state: 'published',
    observed_state: 'published',
    published_version: 2,
    current_version: 2,
    capabilities: { can_publish: false, can_unpublish: true, can_retry: false, can_preview: true },
  })
  assert.equal(planAutomaticSitePublication(published).kind, 'already-published')
  const queued = overview({
    id: '22222222-2222-4222-8222-222222222222',
    desired_state: 'published',
    observed_state: 'queued',
    recent_jobs: [{ status: 'pending' }],
  })
  assert.equal(planAutomaticSitePublication(queued).kind, 'processing')
  const outdatedQueued = overview({
    id: '22222222-2222-4222-8222-222222222222',
    desired_state: 'published',
    observed_state: 'queued',
    is_outdated: true,
    updated_at: '2026-09-28T11:00:00Z',
    recent_jobs: [{ status: 'pending' }],
  })
  const outdatedResult = planAutomaticSitePublication(outdatedQueued)
  assert.equal(outdatedResult.kind, 'publish')
  const outdatedPublishedRetry = overview({
    id: '22222222-2222-4222-8222-222222222222',
    desired_state: 'published',
    observed_state: 'published',
    is_outdated: true,
    current_version: 2,
    published_version: 1,
    updated_at: '2026-09-28T11:00:00Z',
    recent_jobs: [{ status: 'retry' }],
    capabilities: { can_publish: false, can_unpublish: false, can_retry: false, can_preview: true },
  })
  assert.equal(planAutomaticSitePublication(outdatedPublishedRetry).kind, 'publish')
  const outdatedBlocked = overview({
    ...outdatedQueued.data.publications[0],
    readiness_state: 'blocked',
    checks: [{ code: 'location', label: 'Localização', severity: 'error', resolved: false, message: 'Informe bairro e cidade.' }],
  })
  assert.equal(planAutomaticSitePublication(outdatedBlocked).kind, 'blocked')
  const pausing = overview({
    id: '22222222-2222-4222-8222-222222222222',
    desired_state: 'published',
    observed_state: 'pausing',
    is_outdated: true,
    recent_jobs: [{ status: 'processing' }],
  })
  assert.equal(planAutomaticSitePublication(pausing).kind, 'blocked')
  assert.equal(planAutomaticSitePublication(overview({}, false)).kind, 'blocked')
})

test('retries only revision conflict with a fresh publication revision and new key', async () => {
  let reads = 0
  const commands: Array<{ revision: string | null; key: string | undefined }> = []
  const result = await requestAutomaticSitePublication('org', 'property', {
    getPublications: async () => {
      reads += 1
      return overview({
        id: '22222222-2222-4222-8222-222222222222',
        desired_state: 'published',
        updated_at: reads === 1 ? '2026-09-28T11:00:00Z' : '2026-09-28T11:00:01Z',
      })
    },
    publishSite: async (_org, _property, input, key) => {
      commands.push({ revision: input.expected_publication_updated_at, key })
      if (commands.length === 1) throw { status: 409, code: 'publication_revision_conflict' }
      return overview({ desired_state: 'published', observed_state: 'queued' })
    },
  }, 'stable-key')
  assert.equal(result.kind, 'requested')
  assert.equal(reads, 2)
  assert.deepEqual(commands, [
    { revision: '2026-09-28T11:00:00Z', key: 'stable-key' },
    { revision: '2026-09-28T11:00:01Z', key: 'stable-key-conflict-retry' },
  ])
})

test('idempotency conflict is not retried', async () => {
  let reads = 0
  await assert.rejects(
    requestAutomaticSitePublication('org', 'property', {
      getPublications: async () => { reads += 1; return overview() },
      publishSite: async () => { throw { status: 409, code: 'idempotency_conflict' } },
    }, 'stable-key'),
    (error: unknown) => typeof error === 'object' && error !== null
      && 'code' in error && error.code === 'idempotency_conflict',
  )
  assert.equal(reads, 1)
})

test('revision conflict accepts worker completion but blocks a new property revision', async () => {
  let publishes = 0
  let reads = 0
  const completed = await requestAutomaticSitePublication('org', 'property', {
    getPublications: async () => {
      reads += 1
      const value = overview(reads === 1 ? {} : {
        desired_state: 'published', observed_state: 'published',
        published_version: 1, current_version: 1,
      })
      if (reads === 2) value.data.property_updated_at = '2026-09-28T12:00:01Z'
      return value
    },
    publishSite: async () => {
      publishes += 1
      throw { status: 409, code: 'publication_revision_conflict' }
    },
  }, 'stable-key')
  assert.equal(completed.kind, 'already-published')
  assert.equal(publishes, 1)

  reads = 0
  const newRevision = await requestAutomaticSitePublication('org', 'property', {
    getPublications: async () => {
      reads += 1
      const value = overview()
      if (reads === 2) value.data.property_updated_at = '2026-09-28T12:00:01Z'
      return value
    },
    publishSite: async () => { throw { status: 409, code: 'publication_revision_conflict' } },
  }, 'stable-key')
  assert.equal(newRevision.kind, 'blocked')
  assert.equal(reads, 2)
})

test('automatic publication stops when the form scope changes while loading the overview', async () => {
  let current = true
  let publishes = 0
  await assert.rejects(requestAutomaticSitePublication('org', 'property', {
    getPublications: async (_org, _id, _signal, intent) => {
      assert.equal(intent?.expectedUserId, 'original-user')
      current = false
      return overview()
    },
    publishSite: async () => { publishes++; return overview() },
  }, 'scope-key', { expectedUserId: 'original-user', canContinue: () => current }), /publication_scope_changed/)
  assert.equal(publishes, 0)
})

test('automatic publication carries the identity guard to the actual request boundary', async () => {
  let current = true
  let sent = 0
  await assert.rejects(requestAutomaticSitePublication('org', 'property', {
    getPublications: async () => overview(),
    publishSite: async (_org, _id, _input, _key, intent) => {
      assert.equal(intent?.expectedUserId, 'original-user')
      current = false
      intent?.onRequestStart?.()
      sent++
      return overview()
    },
  }, 'scope-key', { expectedUserId: 'original-user', canContinue: () => current }), /publication_scope_changed/)
  assert.equal(sent, 0)
})

test('an older save cannot override a completed withdrawal or pause', async () => {
  for (const desired_state of ['unpublished', 'paused']) {
    let sent = 0
    const result = await requestAutomaticSitePublication('org', 'property', {
      getPublications: async () => overview({ id: 'canonical', desired_state, updated_at: 'new-intent' }),
      publishSite: async () => { sent++; return overview() },
    }, 'old-save', { action: { publicationId: 'canonical', publicationUpdatedAt: 'save-start' } })
    assert.equal(result.kind, 'blocked')
    assert.equal(sent, 0)
  }
})

test('a conflict caused by withdrawal never retries with the newer private revision', async () => {
  let reads = 0
  let sent = 0
  const result = await requestAutomaticSitePublication('org', 'property', {
    getPublications: async () => overview({
      id: 'canonical', updated_at: ++reads === 1 ? 'save-start' : 'withdrawn',
      desired_state: reads === 1 ? 'published' : 'unpublished',
    }),
    publishSite: async () => { sent++; throw { status: 409, code: 'publication_revision_conflict' } },
  }, 'old-save', { action: { publicationId: 'canonical', publicationUpdatedAt: 'save-start' } })
  assert.equal(result.kind, 'blocked')
  assert.equal(reads, 2)
  assert.equal(sent, 1)
})

test('a new explicit save may resume only the private revision captured before saving', async () => {
  const current = overview({ id: 'canonical', updated_at: 'private-revision' })
  let sent = 0
  const api = {
    getPublications: async () => current,
    publishSite: async () => { sent++; return overview({ desired_state: 'published', observed_state: 'queued' }) },
  }
  const action = await captureAutomaticSitePublicationAction('org', 'property', api)
  assert.deepEqual(action, { publicationId: 'canonical', publicationUpdatedAt: 'private-revision' })
  assert.equal((await requestAutomaticSitePublication('org', 'property', api, 'new-save', { action })).kind, 'requested')
  assert.equal(sent, 1)
  assert.equal((await requestAutomaticSitePublication('org', 'property', api, 'no-baseline')).kind, 'blocked')
  assert.equal(sent, 1)
})

test('creation recovery retains its initial absent intent when another session withdrew', async () => {
  let sent = 0
  const result = await requestAutomaticSitePublication('org', 'property', {
    getPublications: async () => overview({ id: 'canonical', updated_at: 'withdrawn-after-create' }),
    publishSite: async () => { sent++; return overview() },
  }, 'recovered-create', { action: INITIAL_AUTOMATIC_SITE_PUBLICATION_ACTION })
  assert.equal(result.kind, 'blocked')
  assert.equal(sent, 0)
})

test('capturing intent keeps the actor and form guard across the overview request', async () => {
  let current = true
  await assert.rejects(captureAutomaticSitePublicationAction('org', 'property', {
    getPublications: async (_org, _id, _signal, intent) => {
      assert.equal(intent?.expectedUserId, 'original-user')
      current = false
      intent?.onRequestStart?.()
      return overview()
    },
    publishSite: async () => overview(),
  }, { expectedUserId: 'original-user', canContinue: () => current }), /publication_scope_changed/)
  await assert.rejects(captureAutomaticSitePublicationAction('org', 'property', {
    getPublications: async () => overview({ id: 'canonical', updated_at: null }),
    publishSite: async () => overview(),
  }), /publication_revision_unavailable/)
})

test('fresh consent denial blocks equal published versions and processing snapshots', async () => {
  for (const observed_state of ['published', 'queued']) {
    const result = planAutomaticSitePublication(overview({
      id: 'canonical', desired_state: 'published', observed_state,
      published_version: 2, current_version: 2, is_outdated: false,
      readiness_state: 'blocked',
      checks: [{ code: 'commercialization', label: 'Comercialização', severity: 'error', resolved: false, message: 'Autorize a comercialização.' }],
    }))
    assert.deepEqual(result, { kind: 'blocked', reasons: ['Autorize a comercialização.'], fixableInForm: true })
  }
})

test('a command response must pass fresh eligibility before reporting already published', async () => {
  const result = await requestAutomaticSitePublication('org', 'property', {
    getPublications: async () => overview(),
    publishSite: async () => overview({
      desired_state: 'published', observed_state: 'published', published_version: 1, current_version: 1,
      readiness_state: 'blocked',
      checks: [{ code: 'commercialization', label: 'Comercialização', severity: 'error', resolved: false, message: 'Autorize a comercialização.' }],
    }),
  }, 'save-key')
  assert.equal(result.kind, 'blocked')
})
