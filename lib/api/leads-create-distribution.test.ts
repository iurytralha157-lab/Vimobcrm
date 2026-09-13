import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const leadsAPISource = readFileSync('lib/api/leads.ts', 'utf8')
const importHookSource = readFileSync('hooks/use-leads.ts', 'utf8')
const importDialogSource = readFileSync('components/features/contacts/ImportContactsDialog.tsx', 'utf8')

test('o cliente propaga o controle de distribuicao no contrato de criacao', () => {
  assert.match(leadsAPISource, /auto_distribute\?: boolean/)
  assert.match(leadsAPISource, /round_robin_id\?: string/)
  assert.match(leadsAPISource, /autoDistribute: data\.auto_distribute/)
  assert.match(leadsAPISource, /roundRobinId: data\.round_robin_id/)
  assert.match(leadsAPISource, /distributionOutcome\?: LeadDistributionOutcome/)
  assert.match(leadsAPISource, /distributionOutcome: response\.distributionOutcome/)
})

test('a importacao separa falha de criacao de alerta de distribuicao', () => {
  assert.match(importHookSource, /resolveImportDistributionOutcome/)
  assert.match(importHookSource, /distribution: \{ \.\.\.distribution \}/)
  assert.match(importHookSource, /distribution,\s*\n\s*};/)
  assert.match(importDialogSource, /Resultado da atribuição/)
  assert.match(importDialogSource, /nenhuma fila ativa correspondeu às regras/)
  assert.match(importDialogSource, /a fila não tinha membro disponível/)
  assert.match(importDialogSource, /responsável anterior e não foram redistribuídas/)
})
