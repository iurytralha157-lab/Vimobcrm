import assert from 'node:assert/strict'
import test from 'node:test'

import {
  UNIT_PAGE_SIZE,
  developmentUnitEventLabel,
  inventoryTone,
} from './model'

test('mantém a paginação do espelho de unidades em lotes de cinquenta', () => {
  assert.equal(UNIT_PAGE_SIZE, 50)
})

test('preserva os tons operacionais de cada estado do estoque', () => {
  assert.match(inventoryTone('available'), /emerald/)
  assert.match(inventoryTone('reserved'), /amber/)
  assert.match(inventoryTone('sold'), /blue/)
  assert.match(inventoryTone('negotiation'), /violet/)
  assert.match(inventoryTone('blocked'), /muted/)
})

test('traduz os eventos conhecidos e mantém eventos futuros legíveis', () => {
  assert.equal(
    developmentUnitEventLabel({ event_type: 'reservation_created' }),
    'Reserva criada',
  )
  assert.equal(
    developmentUnitEventLabel({ event_type: 'future_event' }),
    'future_event',
  )
})

test('distingue o desvínculo de ficha dentro do evento property_linked', () => {
  assert.equal(
    developmentUnitEventLabel({
      event_type: 'property_linked',
      metadata: { operation: 'unlink_property' },
    }),
    'Ficha de imóvel desvinculada',
  )
  assert.equal(
    developmentUnitEventLabel({ event_type: 'property_linked' }),
    'Ficha de imóvel vinculada',
  )
})
