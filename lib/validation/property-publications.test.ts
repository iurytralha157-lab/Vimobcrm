import assert from 'node:assert/strict'
import test from 'node:test'

import {
  propertyPublicationNeedsPolling,
  propertyPublicationNeedsProviderFeedbackPolling,
  propertyPublicationPollingSettled,
} from '../utils/property-publication-polling'

import {
  apiPropertyPublicationOverviewResponseSchema,
  mutatePropertyPublicationInputSchema,
  propertyPublicationCommandChannelSchema,
  propertyPublicationObservedStateSchema,
  publishPropertyInputSchema,
} from './property-publications'

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'

function publicationOverviewFixture() {
  return {
    data: {
      property_id: PROPERTY_ID,
      property_updated_at: '2026-08-01T12:00:00Z',
      publications: [{
        id: null,
        channel: 'site',
        channel_account_key: 'default',
        label: 'Site da imobiliária',
        available: true,
        desired_state: 'unpublished',
        observed_state: 'unpublished',
        readiness_state: 'ready',
        readiness_score: 100,
        checks: [{
          code: 'title',
          label: 'Título público preenchido',
          severity: 'error',
          resolved: true,
        }],
        current_version: 0,
        published_version: null,
        is_outdated: false,
        public_url: null,
        preview: {
          title: 'Apartamento central',
          price: 450000,
          image_urls: ['/v1/public/property-publications/image'],
        },
        capabilities: {
          can_publish: true,
          can_unpublish: false,
          can_retry: false,
          can_preview: true,
        },
        last_error: null,
      }],
    },
    meta: { can_manage: true },
  }
}

test('publication overview accepts canonical states and defaults recent jobs', () => {
  const parsed = apiPropertyPublicationOverviewResponseSchema.parse(publicationOverviewFixture())
  assert.equal(parsed.data.publications[0].observed_state, 'unpublished')
  assert.deepEqual(parsed.data.publications[0].recent_jobs, [])
})

test('publication overview accepts Grupo OLX with an opaque account key', () => {
  const fixture = publicationOverviewFixture()
  const grupoOLXPublication = {
    ...fixture.data.publications[0],
    id: '22222222-2222-4222-8222-222222222222',
    channel: 'grupo_olx',
    channel_account_key: 'account:7f33f0ad-opaque',
    label: 'Grupo OLX · ZAP · Viva Real',
    desired_state: 'published',
    observed_state: 'published',
    current_version: 1,
    published_version: 1,
    capabilities: {
      can_publish: false,
      can_unpublish: true,
      can_retry: false,
      can_preview: true,
    },
    provider_feedback: {
      scope: 'listing_id',
      version_bound: false,
      listing_id: 'VIMOB-123',
      report_id: 'report-2026-08-01',
      severity: 'warning',
      messages: ['O portal recomendou revisar a foto principal.'],
      provider_occurred_at: '2026-08-01T15:00:00Z',
      received_at: '2026-08-01T15:00:01Z',
    },
  }
  const overview = {
    ...fixture,
    data: {
      ...fixture.data,
      publications: [...fixture.data.publications, grupoOLXPublication],
    },
  }

  const parsed = apiPropertyPublicationOverviewResponseSchema.parse(overview)
  assert.equal(parsed.data.publications[1].channel, 'grupo_olx')
  assert.equal(parsed.data.publications[1].channel_account_key, 'account:7f33f0ad-opaque')
  assert.equal(parsed.data.publications[1].observed_state, 'published')
  assert.equal(parsed.data.publications[1].provider_feedback?.version_bound, false)
})

test('publication command channels use canonical names instead of route segments', () => {
  assert.equal(propertyPublicationCommandChannelSchema.safeParse('site').success, true)
  assert.equal(propertyPublicationCommandChannelSchema.safeParse('grupo_olx').success, true)
  assert.equal(propertyPublicationCommandChannelSchema.safeParse('grupo-olx').success, false)
  assert.equal(propertyPublicationCommandChannelSchema.safeParse('unknown_portal').success, false)
})

test('publication polling remains active for transient states and refreshes consumers once settled', () => {
  assert.equal(propertyPublicationNeedsPolling({
    data: {
      publications: [{ observed_state: 'publishing', recent_jobs: [] }],
    },
  }), true)
  assert.equal(propertyPublicationNeedsPolling({
    data: {
      publications: [{ observed_state: 'published', recent_jobs: [{ status: 'processing' }] }],
    },
  }), true)
  assert.equal(propertyPublicationNeedsPolling({
    data: {
      publications: [{ observed_state: 'published', recent_jobs: [{ status: 'succeeded' }] }],
    },
  }), false)
  assert.equal(propertyPublicationPollingSettled(true, false), true)
  assert.equal(propertyPublicationPollingSettled(false, false), false)
  assert.equal(propertyPublicationPollingSettled(true, true), false)
})

test('publication polling keeps a light refresh for delayed Grupo OLX feedback', () => {
  assert.equal(propertyPublicationNeedsProviderFeedbackPolling({
    data: {
      publications: [{
        channel: 'grupo_olx',
        available: true,
        id: '22222222-2222-4222-8222-222222222222',
        observed_state: 'published',
        published_version: 1,
        recent_jobs: [{ status: 'succeeded' }],
      }],
    },
  }), true)

  assert.equal(propertyPublicationNeedsProviderFeedbackPolling({
    data: {
      publications: [{
        channel: 'site',
        available: true,
        id: '22222222-2222-4222-8222-222222222222',
        observed_state: 'published',
        published_version: 1,
        recent_jobs: [{ status: 'succeeded' }],
      }],
    },
  }), false)

  assert.equal(propertyPublicationNeedsProviderFeedbackPolling({
    data: {
      publications: [{
        channel: 'grupo_olx',
        available: true,
        id: '22222222-2222-4222-8222-222222222222',
        observed_state: 'queued',
        published_version: null,
        recent_jobs: [{ status: 'pending' }],
      }],
    },
  }), false)
})

test('publication overview rejects unsafe preview URLs and internal fields', () => {
  const unsafeURL = publicationOverviewFixture()
  unsafeURL.data.publications[0].preview.image_urls = ['javascript:alert(1)']
  assert.equal(apiPropertyPublicationOverviewResponseSchema.safeParse(unsafeURL).success, false)

  const internalField = publicationOverviewFixture() as ReturnType<typeof publicationOverviewFixture> & {
    data: {
      publications: Array<ReturnType<typeof publicationOverviewFixture>['data']['publications'][number] & {
        feed_token?: string
      }>
    }
  }
  internalField.data.publications[0].feed_token = 'must-not-enter-cache'
  assert.equal(apiPropertyPublicationOverviewResponseSchema.safeParse(internalField).success, false)

  const grupoOLXInternalField = {
    ...publicationOverviewFixture(),
    data: {
      ...publicationOverviewFixture().data,
      publications: [{
        ...publicationOverviewFixture().data.publications[0],
        channel: 'grupo_olx',
        channel_account_key: 'opaque-account-key',
        label: 'Grupo OLX · ZAP · Viva Real',
        webhook_token: 'must-not-enter-cache',
      }],
    },
  }
  assert.equal(apiPropertyPublicationOverviewResponseSchema.safeParse(grupoOLXInternalField).success, false)
})

test('publication schemas reject synthetic states and stale timestamp shapes', () => {
  assert.equal(propertyPublicationObservedStateSchema.safeParse('retrying').success, false)
  assert.equal(propertyPublicationObservedStateSchema.safeParse('processing').success, false)
  assert.equal(publishPropertyInputSchema.safeParse({
    expected_property_updated_at: 'invalid',
    expected_publication_updated_at: null,
  }).success, false)
  assert.equal(publishPropertyInputSchema.safeParse({
    expected_property_updated_at: '2026-08-01T12:00:00Z',
    expected_publication_updated_at: null,
  }).success, true)
  assert.equal(publishPropertyInputSchema.safeParse({
    expected_property_updated_at: '2026-08-01T12:00:00Z',
    expected_publication_updated_at: '2026-08-01T12:01:00Z',
  }).success, true)
  assert.equal(mutatePropertyPublicationInputSchema.safeParse({
    expected_publication_updated_at: '2026-08-01T12:00:00-03:00',
  }).success, true)
  assert.equal(publishPropertyInputSchema.safeParse({
    expected_property_updated_at: '2026-08-01T12:00:00Z',
    expected_publication_updated_at: null,
    channel_account_key: 'must-stay-out-of-the-command',
  }).success, false)
  assert.equal(mutatePropertyPublicationInputSchema.safeParse({
    expected_publication_updated_at: '2026-08-01T12:00:00Z',
    feed_token: 'must-stay-out-of-the-command',
  }).success, false)
})
