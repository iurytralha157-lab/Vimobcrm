import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_ACTIVITY_IDLE_AFTER_MS,
  getIdleCheckDelay,
  getUserActivityAttentionStatus,
  isActivityIdle,
  isTrustedUserActivityEvent,
  shouldMarkUserActivityOnline,
  USER_ACTIVITY_INPUT_EVENTS,
} from './user-activity-state'

test('mantem online antes do limite real de inatividade', () => {
  const lastActivityAt = 1_000

  assert.equal(
    isActivityIdle(
      lastActivityAt,
      lastActivityAt + DEFAULT_ACTIVITY_IDLE_AFTER_MS - 1,
    ),
    false,
  )
  assert.equal(
    getIdleCheckDelay(
      lastActivityAt,
      lastActivityAt + DEFAULT_ACTIVITY_IDLE_AFTER_MS - 1,
    ),
    1,
  )
})

test('marca ausente no limite e tolera relogio monotonicamente atrasado', () => {
  const lastActivityAt = 10_000

  assert.equal(
    isActivityIdle(
      lastActivityAt,
      lastActivityAt + DEFAULT_ACTIVITY_IDLE_AFTER_MS,
    ),
    true,
  )
  assert.equal(getIdleCheckDelay(lastActivityAt, lastActivityAt - 500), DEFAULT_ACTIVITY_IDLE_AFTER_MS)
})

test('ignora eventos sinteticos e aceita apenas atividade humana confiavel', () => {
  assert.equal(isTrustedUserActivityEvent({ isTrusted: false }), false)
  assert.equal(isTrustedUserActivityEvent({ isTrusted: true }), true)
})

test('so permite ficar online com evento confiavel, aba visivel e foco', () => {
  assert.equal(shouldMarkUserActivityOnline({
    isTrusted: true,
    visibilityState: 'visible',
    hasFocus: true,
  }), true)
  assert.equal(shouldMarkUserActivityOnline({
    isTrusted: false,
    visibilityState: 'visible',
    hasFocus: true,
  }), false)
  assert.equal(shouldMarkUserActivityOnline({
    isTrusted: true,
    visibilityState: 'hidden',
    hasFocus: true,
  }), false)
  assert.equal(shouldMarkUserActivityOnline({
    isTrusted: true,
    visibilityState: 'visible',
    hasFocus: false,
  }), false)
})

test('considera sem atencao uma aba oculta ou uma janela sem foco', () => {
  assert.equal(getUserActivityAttentionStatus('visible', true), 'online')
  assert.equal(getUserActivityAttentionStatus('visible', false), 'idle')
  assert.equal(getUserActivityAttentionStatus('hidden', true), 'idle')
})

test('ouve apenas interacoes discretas e nunca movimento ou scroll sintetico', () => {
  assert.deepEqual(USER_ACTIVITY_INPUT_EVENTS, [
    'keydown',
    'pointerdown',
    'touchstart',
    'wheel',
  ])
  assert.equal(USER_ACTIVITY_INPUT_EVENTS.includes('pointermove' as never), false)
  assert.equal(USER_ACTIVITY_INPUT_EVENTS.includes('scroll' as never), false)
})
