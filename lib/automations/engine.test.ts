import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyAutomationReply,
  evaluateAutomationCondition,
  renderAutomationTemplate,
  unknownAutomationTemplateVariables,
} from './engine'

const replyCases = [
  ['pode ser', 'positive'],
  ['Claro, vamos!', 'positive'],
  ['não quero', 'negative'],
  ['pode parar', 'negative'],
  ['não tem problema, pode ser', 'positive'],
  ['sim, mas agora não', 'negative'],
  ['talvez', 'uncertain'],
  ['quem é?', 'uncertain'],
  ['simplesmente queria saber o preço', 'uncertain'],
] as const

test('classifica respostas em português sem confundir palavras parciais', () => {
  for (const [content, expected] of replyCases) {
    assert.equal(classifyAutomationReply(content).classification, expected, content)
  }
})

test('a resposta recente tem precedência sobre a mensagem que iniciou o fluxo', () => {
  const result = evaluateAutomationCondition(
    { condition_type: 'response_sentiment' },
    {
      execution: {
        trigger_data: { content: 'não quero' },
        reply_payload: { content: 'pode ser' },
      },
    },
  )
  assert.equal(result.branch, 'true')
})

test('resposta vazia ou não reconhecida segue para a saída segura', () => {
  assert.equal(evaluateAutomationCondition(
    { condition_type: 'response_sentiment' },
    { execution: { reply_payload: { content: '' }, trigger_data: { content: 'sim' } } },
  ).branch, 'unknown')
  assert.equal(evaluateAutomationCondition(
    { condition_type: 'response_sentiment' },
    { execution: { trigger_data: { content: 'sim' } } },
  ).branch, 'unknown')
  assert.equal(evaluateAutomationCondition(
    { condition_type: 'response_sentiment' },
    { execution: { reply_payload: { content: 'talvez' } } },
  ).branch, 'unknown')
})

test('avalia condição personalizada com normalização e lista explícita', () => {
  const context = { lead: { name: 'João Silva', source: 'Facebook Ads' } }
  assert.equal(evaluateAutomationCondition({
    condition_type: 'custom', variable: 'lead.name', operator: 'contains', value: 'joao',
  }, context).branch, 'true')
  assert.equal(evaluateAutomationCondition({
    condition_type: 'custom', variable: 'lead.source', operator: 'contains_any', value: 'site, facebook',
  }, context).branch, 'true')
  assert.equal(evaluateAutomationCondition({
    condition_type: 'custom', variable: '{{lead.name}}', operator: 'contains', value: 'joão',
  }, context).branch, 'false')
})

test('renderiza no Preview as mesmas variáveis e espaços aceitos pelo runtime', () => {
  assert.equal(
    renderAutomationTemplate('Olá, {{ lead.name }}! Você veio de {{lead.source}}.', {
      lead: { name: 'João Silva', source: 'Site' },
    }),
    'Olá, João Silva! Você veio de Site.',
  )
})

test('rejeita variável desconhecida e sintaxe de template incompleta', () => {
  assert.deepEqual(unknownAutomationTemplateVariables('Olá {{lead.name}}'), [])
  assert.deepEqual(unknownAutomationTemplateVariables('Olá {{lead.apelido}}'), ['lead.apelido'])
  assert.deepEqual(unknownAutomationTemplateVariables('Olá {{lead.name}'), ['invalid_template_syntax'])
})
