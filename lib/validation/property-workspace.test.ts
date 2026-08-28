import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  apiPropertyWorkspaceResponseSchema,
  propertyAssetCreateInputSchema,
  propertyAssetOrderInputSchema,
  propertyAssetUploadIntentInputSchema,
  propertyKeyMovementInputSchema,
  propertyOfferUpsertInputSchema,
  propertyOwnershipCreateInputSchema,
  propertyOwnershipUpdateInputSchema,
} from './property-workspace'

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222'
const OWNERSHIP_ID = '33333333-3333-4333-8333-333333333333'
const OWNER_ID = '44444444-4444-4444-8444-444444444444'

function workspaceResponseFixture() {
  return {
    data: {
      property: {
        id: PROPERTY_ID,
        organization_id: ORGANIZATION_ID,
        code: 'IMV-001',
        title: 'Apartamento central',
        status: 'ativo',
        tipo: 'Apartamento',
        tipo_de_imovel: 'Apartamento',
        published_on_site: false,
        anunciar: false,
        imagem_principal: null,
        image_urls: [],
        fotos: [],
        quartos: 2,
        banheiros: 1,
        vagas: 1,
        area_util: 68,
        area_total: 75,
        descricao: null,
        descricao_site: null,
        endereco: 'Rua Central',
        numero: '100',
        complemento: 'Apto 42',
        bairro: 'Centro',
        cidade: 'Curitiba',
        uf: 'PR',
        cep: '80000-000',
        address_visibility: 'full',
        public_address_visibility: 'neighborhood',
        iptu: 120,
        preco: 450000,
        valor_locacao: null,
        condominio: 650,
        suites: 1,
        aceita_permuta: true,
        proximidades: ['Escola', 'Mercado'],
        zoneamento: 'ZR-4',
        owner_name: 'Proprietario legado',
        owner_email: 'must-not-enter-cache@example.com',
        comentarios_internos: 'must not enter the workspace projection',
        numero_matricula: 'MAT-001',
        aprovacao_ambiental: 'aprovada',
        unlisted_private_field: 'must always be stripped',
      },
      offers: [],
      ownerships: [{
        id: OWNERSHIP_ID,
        organization_id: ORGANIZATION_ID,
        property_id: PROPERTY_ID,
        owner_id: OWNER_ID,
        ownership_percentage: 100,
        is_primary: true,
        valid_from: '2026-08-01',
        valid_to: null,
        notes: 'private ownership note',
        owner: {
          id: OWNER_ID,
          name: 'Maria Proprietaria',
          cellphone: null,
          email: null,
          media_source: null,
          notify_email: false,
          notes: 'private owner note',
          created_at: '2026-08-01T11:00:00Z',
          updated_at: '2026-08-01T12:00:00Z',
          cpf: '000.000.000-00',
        },
        created_at: '2026-08-01T12:00:00Z',
        updated_at: '2026-08-01T12:00:00Z',
      }],
      assets: [],
      keys: [],
      recent_key_movements: [],
      summary: {
        completeness_score: 80,
        publication_ready: false,
        checklist: [{ code: 'title', label: 'Titulo preenchido', resolved: true }],
        counts: {
          offers: 0,
          owners: 1,
          photos: 0,
          documents: 0,
          keys: 0,
          key_history: 0,
        },
      },
    },
    meta: {
      can_manage: false,
      can_view_owner_contacts: false,
      can_view_confidential: false,
    },
  }
}

test('property offer requires a positive value when active', () => {
  const invalid = propertyOfferUpsertInputSchema.safeParse({
    status: 'active',
    price: 0,
    currency: 'BRL',
  })
  assert.equal(invalid.success, false)

  const valid = propertyOfferUpsertInputSchema.parse({
    status: 'active',
    price: 2750,
    currency: 'brl',
    price_period: 'monthly',
  })
  assert.equal(valid.currency, 'BRL')
  assert.equal(valid.price, 2750)
})

test('property offer rejects reversed availability dates', () => {
  const result = propertyOfferUpsertInputSchema.safeParse({
    status: 'draft',
    price: null,
    currency: 'BRL',
    available_from: '2026-08-20',
    available_until: '2026-08-10',
  })
  assert.equal(result.success, false)
})

test('workspace offer precondition requires an RFC3339 timestamp with offset', () => {
  assert.equal(propertyOfferUpsertInputSchema.safeParse({
    status: 'draft',
    price: null,
    currency: 'BRL',
    expected_updated_at: 'invalid',
  }).success, false)

  assert.equal(propertyOfferUpsertInputSchema.safeParse({
    status: 'draft',
    price: null,
    currency: 'BRL',
    expected_updated_at: '2026-08-01T12:00:00-03:00',
  }).success, true)
})

test('key checkout requires a holder and location change requires a destination', () => {
  assert.equal(propertyKeyMovementInputSchema.safeParse({ movement_type: 'checkout' }).success, false)
  assert.equal(propertyKeyMovementInputSchema.safeParse({ movement_type: 'location_change' }).success, false)
  assert.equal(propertyKeyMovementInputSchema.safeParse({
    movement_type: 'checkout',
    holder_name: 'Maria Corretora',
  }).success, true)
})

test('ownership create requires exactly one owner source', () => {
  const relationship = {
    ownership_percentage: 50,
    is_primary: false,
    valid_from: '2026-08-01',
  }
  assert.equal(propertyOwnershipCreateInputSchema.safeParse(relationship).success, false)
  assert.equal(propertyOwnershipCreateInputSchema.safeParse({
    ...relationship,
    owner_id: OWNER_ID,
    new_owner: { name: 'Duplicado' },
  }).success, false)
  assert.equal(propertyOwnershipCreateInputSchema.safeParse({
    ...relationship,
    owner_id: OWNER_ID,
  }).success, true)
})

test('ownership owner update has an independent concurrency precondition', () => {
  const base = {
    ownership_percentage: 100,
    is_primary: true,
    valid_from: '2026-08-01',
    expected_updated_at: '2026-08-01T12:00:00Z',
  }
  assert.equal(propertyOwnershipUpdateInputSchema.safeParse({
    ...base,
    owner: { name: 'Maria' },
  }).success, false)
  assert.equal(propertyOwnershipUpdateInputSchema.safeParse({
    ...base,
    owner: {
      name: 'Maria',
      expected_updated_at: '2026-08-01T12:00:00Z',
    },
  }).success, true)
})

test('assets accept only HTTP locators and one source', () => {
  const base = {
    asset_type: 'virtual_tour' as const,
    visibility: 'public' as const,
  }
  assert.equal(propertyAssetCreateInputSchema.safeParse({
    ...base,
    external_url: 'javascript:alert(1)',
  }).success, false)
  assert.equal(propertyAssetCreateInputSchema.safeParse({
    ...base,
    external_url: 'https://tour.example.test/property',
  }).success, true)
  assert.equal(propertyAssetCreateInputSchema.safeParse({
    ...base,
    external_url: 'https://tour.example.test/property',
    storage_path: 'org/property/tour',
  }).success, false)
})

test('asset upload intent enforces 10 MB and MIME rules by type', () => {
  const base = {
    file_name: 'arquivo.pdf',
    mime_type: 'application/pdf' as const,
    file_size_bytes: 1024,
  }
  assert.equal(propertyAssetUploadIntentInputSchema.safeParse({ ...base, asset_type: 'document' }).success, true)
  assert.equal(propertyAssetUploadIntentInputSchema.safeParse({ ...base, asset_type: 'photo' }).success, false)
  assert.equal(propertyAssetUploadIntentInputSchema.safeParse({
    ...base,
    asset_type: 'document',
    file_size_bytes: 10 * 1024 * 1024 + 1,
  }).success, false)
})

test('asset ordering is bounded to 200 unique rows', () => {
  const item = {
    id: OWNERSHIP_ID,
    sort_order: 0,
    expected_updated_at: '2026-08-01T12:00:00Z',
  }
  assert.equal(propertyAssetOrderInputSchema.safeParse({ items: [item, item] }).success, false)
  assert.equal(propertyAssetOrderInputSchema.safeParse({
    items: Array.from({ length: 201 }, (_, index) => ({
      ...item,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      sort_order: index,
    })),
  }).success, false)
})

test('workspace response keeps an explicit safe projection of database rows', () => {
  const parsed = apiPropertyWorkspaceResponseSchema.parse(workspaceResponseFixture())

  assert.equal('owner_email' in parsed.data.property, false)
  assert.equal('comentarios_internos' in parsed.data.property, false)
  assert.equal('numero_matricula' in parsed.data.property, false)
  assert.equal('aprovacao_ambiental' in parsed.data.property, false)
  assert.equal('unlisted_private_field' in parsed.data.property, false)
  assert.equal(parsed.data.property.complemento, 'Apto 42')
  assert.equal(parsed.data.property.condominio, 650)
  assert.equal(parsed.data.property.suites, 1)
  assert.equal(parsed.data.property.aceita_permuta, true)
  assert.deepEqual(parsed.data.property.proximidades, ['Escola', 'Mercado'])
  assert.equal(parsed.data.property.zoneamento, 'ZR-4')
  assert.equal('notes' in parsed.data.ownerships[0], false)
  assert.equal('notes' in parsed.data.ownerships[0].owner, false)
  assert.equal('cpf' in parsed.data.ownerships[0].owner, false)
})

test('workspace responsible compatibility alias accepts only UUID or null', () => {
	const missingResponsible = workspaceResponseFixture()
	;(missingResponsible.data.property as Record<string, unknown>).cadastrado_por = null
	assert.equal(
		apiPropertyWorkspaceResponseSchema.parse(missingResponsible).data.property.cadastrado_por,
		null,
	)

	for (const invalid of ['', 'captador legado']) {
		const fixture = workspaceResponseFixture()
		;(fixture.data.property as Record<string, unknown>).cadastrado_por = invalid
		assert.equal(apiPropertyWorkspaceResponseSchema.safeParse(fixture).success, false)
	}
})

test('workspace response accepts legacy and degraded capability metadata', () => {
  const legacy = apiPropertyWorkspaceResponseSchema.parse(workspaceResponseFixture())
  assert.equal(legacy.meta.normalized_resources_available, true)
  assert.deepEqual(legacy.meta.unavailable_resources, [])

  const fixture = workspaceResponseFixture()
  const degraded = apiPropertyWorkspaceResponseSchema.parse({
    ...fixture,
    meta: {
      ...fixture.meta,
      normalized_resources_available: false,
      unavailable_resources: ['offers', 'ownerships', 'assets', 'keys', 'key_history'],
    },
  })
  assert.equal(degraded.meta.normalized_resources_available, false)
  assert.deepEqual(degraded.meta.unavailable_resources, [
    'offers',
    'ownerships',
    'assets',
    'keys',
    'key_history',
  ])
})

test('workspace response preserves owner and ownership notes only for managers', () => {
  const fixture = workspaceResponseFixture()
  fixture.meta.can_manage = true
  fixture.meta.can_view_owner_contacts = true
  fixture.meta.can_view_confidential = true
  const parsed = apiPropertyWorkspaceResponseSchema.parse(fixture)

  assert.equal(parsed.data.ownerships[0].notes, 'private ownership note')
  assert.equal(parsed.data.ownerships[0].owner.notes, 'private owner note')
  assert.equal(parsed.data.property.owner_email, 'must-not-enter-cache@example.com')
  assert.equal(parsed.data.property.comentarios_internos, 'must not enter the workspace projection')
  assert.equal(parsed.data.property.numero_matricula, 'MAT-001')
  assert.equal(parsed.data.property.aprovacao_ambiental, 'aprovada')
})

test('workspace response rejects fields outside its envelope contract', () => {
  const fixture = workspaceResponseFixture()
  const result = apiPropertyWorkspaceResponseSchema.safeParse({
    ...fixture,
    unexpected: true,
  })

  assert.equal(result.success, false)
})

test('property workspace keeps compatibility details internal and exposes carousel controls', () => {
  const screenSource = readFileSync('components/features/properties/PropertyWorkspaceScreen.tsx', 'utf8')
  const overviewSource = readFileSync('components/features/properties/detail/PropertyWorkspaceOverview.tsx', 'utf8')
  const sectionsSource = readFileSync('components/features/properties/detail/PropertyWorkspaceSections.tsx', 'utf8')
  const visibleSources = [screenSource, overviewSource, sectionsSource]

  for (const technicalCopy of [
    'Cadastro legado',
    'Dados normalizados',
    ' · parcial',
    'Cadastro legado em modo seguro',
    'Recursos normalizados ativos',
    'Mídias e documentos normalizados',
    'O catálogo normalizado ainda não está disponível',
    'Vínculo do cadastro legado',
    'imagem disponível',
    'imagens disponíveis',
  ]) {
    assert.equal(
      visibleSources.some((source) => source.includes(technicalCopy)),
      false,
      `technical compatibility copy must stay out of the UI: ${technicalCopy}`,
    )
  }

  assert.match(overviewSource, /aria-label="Foto anterior"/)
  assert.match(overviewSource, /aria-label="Próxima foto"/)
  assert.match(overviewSource, /\[scrollbar-width:none\]/)
  assert.match(overviewSource, /scrollIntoView/)
})
