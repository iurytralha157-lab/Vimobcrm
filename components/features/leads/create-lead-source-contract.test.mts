import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const createLeadDialogSource = readFileSync(
  new URL('./CreateLeadDialog.tsx', import.meta.url),
  'utf8',
)
const leadSourceSelectSource = readFileSync(
  new URL('./LeadSourceSelect.tsx', import.meta.url),
  'utf8',
)
const leadsHookSource = readFileSync(
  new URL('../../../hooks/use-leads.ts', import.meta.url),
  'utf8',
)

test('novo lead usa um seletor de origem criavel compartilhado por todos os atalhos', () => {
  assert.match(createLeadDialogSource, /<LeadSourceSelect/)
  assert.match(createLeadDialogSource, /onValueChange=\{\(value\) => updateField\('source', value\)\}/)
  assert.doesNotMatch(createLeadDialogSource, /<SelectItem value="meta_ads">Meta Ads<\/SelectItem>/)
  assert.doesNotMatch(createLeadDialogSource, /<SelectItem value="outro">Outro<\/SelectItem>/)
})

test('criacao inline nunca envia a sentinela e oferece confirmar, cancelar e teclado', () => {
  assert.match(leadSourceSelectSource, /nextValue === LEAD_SOURCE_CREATE_VALUE/)
  assert.match(leadSourceSelectSource, /resolveLeadSourceInput\(draft\)/)
  assert.match(leadSourceSelectSource, /maxLength=\{80\}/)
  assert.match(leadSourceSelectSource, /event\.key === 'Enter'/)
  assert.match(leadSourceSelectSource, /event\.key === 'Escape'/)
  assert.match(leadSourceSelectSource, /A nova origem será gravada quando o lead for salvo\./)
  assert.doesNotMatch(leadSourceSelectSource, /useQuery|getLeadMetaFilters|contactsAPI/)
})

test('salvar ou editar uma origem torna as opcoes dinamicas obsoletas imediatamente', () => {
  assert.match(leadsHookSource, /function invalidateLeadSourceOptions/)
  assert.match(leadsHookSource, /queryKey: \['shared-filter-lead-meta-filters'\]/)
  assert.match(leadsHookSource, /queryKey: \['lead-meta-filters'\]/)
  assert.match(leadsHookSource, /if \(variables\.source !== undefined\) invalidateLeadSourceOptions/)
})
