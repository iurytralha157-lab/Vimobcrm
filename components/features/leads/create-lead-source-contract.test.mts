import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const createLeadDialogSource = readFileSync(
  new URL('./CreateLeadDialog.tsx', import.meta.url),
  'utf8',
)
const leadContactFieldsSource = readFileSync(
  new URL('./lead-form/LeadContactFields.tsx', import.meta.url),
  'utf8',
)
const leadSourceSelectSource = readFileSync(
  new URL('./LeadSourceSelect.tsx', import.meta.url),
  'utf8',
)
const leadSourcesHookSource = readFileSync(
  new URL('../../../hooks/use-lead-sources.ts', import.meta.url),
  'utf8',
)
const leadSourcesAPISource = readFileSync(
  new URL('../../../lib/api/lead-sources.ts', import.meta.url),
  'utf8',
)

test('novo lead usa um seletor de origem criavel compartilhado por todos os atalhos', () => {
  assert.match(createLeadDialogSource, /<LeadContactFields[\s\S]*?updateField=\{updateField\}/)
  assert.match(leadContactFieldsSource, /<LeadSourceSelect/)
  assert.match(leadContactFieldsSource, /onValueChange=\{\(value\) => updateField\('source', value\)\}/)
  assert.doesNotMatch(leadContactFieldsSource, /<SelectItem value="meta_ads">Meta Ads<\/SelectItem>/)
  assert.doesNotMatch(leadContactFieldsSource, /<SelectItem value="outro">Outro<\/SelectItem>/)
})

test('origem usa o mesmo popup de busca + criar do DDI e das tags, com origens organizadas por organizacao', () => {
  // mesmo formato visual/comportamental: busca compacta, scroll nativo com fix de wheel, rodape fixo de criacao
  assert.match(leadSourceSelectSource, /Buscar ou criar origem/)
  assert.match(leadSourceSelectSource, /className="h-8 py-1 pl-8 text-sm"/)
  assert.match(leadSourceSelectSource, /overflow-y-auto overscroll-contain/)
  assert.match(leadSourceSelectSource, /addEventListener\('wheel', handleWheel/)
  assert.match(leadSourceSelectSource, /rounded-b-md border-t border-\[var\(--app-border\)\]/)
  assert.match(leadSourceSelectSource, /Criar nova origem/)
  assert.match(leadSourceSelectSource, /resolveLeadSourceInput\(searchTerm\)/)
  assert.match(leadSourceSelectSource, /event\.key === 'Enter'/)
  assert.match(leadSourceSelectSource, /event\.key === 'Escape'/)

  // origens personalizadas sao carregadas/criadas por organizacao, nunca vazam entre contas
  assert.match(leadSourceSelectSource, /useLeadSources\(\)/)
  assert.match(leadSourceSelectSource, /useCreateLeadSource\(\)/)
  assert.match(leadSourcesHookSource, /organizationId = activeOrganization\.organizationId/)
  assert.match(leadSourcesHookSource, /queryKey: \['lead-sources', organizationId\]/)
  assert.match(leadSourcesAPISource, /async create\(input: \{ name: string \}, organizationId/)
})

test('salvar ou editar uma origem torna as opcoes dinamicas obsoletas imediatamente', () => {
  const leadsHookSource = readFileSync(
    new URL('../../../hooks/use-leads.ts', import.meta.url),
    'utf8',
  )
  assert.match(leadsHookSource, /function invalidateLeadSourceOptions/)
  assert.match(leadsHookSource, /queryKey: \['shared-filter-lead-meta-filters'\]/)
  assert.match(leadsHookSource, /queryKey: \['lead-meta-filters'\]/)
  assert.match(leadsHookSource, /useCreateLead\(\)[\s\S]*?onSuccess:[\s\S]*?invalidateLeadSourceOptions\(queryClient\)/)
  assert.match(leadsHookSource, /const updateCache = useLeadUpdateCache\(queryClient, organizationId, user\?\.id\)/)
  assert.match(leadsHookSource, /onSuccess: updateCache\.onSuccess/)
  const updateCacheSource = readFileSync(new URL('../../../hooks/leads/use-lead-update-cache.ts', import.meta.url), 'utf8')
  assert.match(updateCacheSource, /if \(variables\.source !== undefined\) \{[^}]*\{ queryKey: \['shared-filter-lead-meta-filters'\] \}[^}]*\{ queryKey: \['lead-meta-filters'\] \}/)
})
