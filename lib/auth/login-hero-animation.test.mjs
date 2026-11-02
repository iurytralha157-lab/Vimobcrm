import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const compiled = ts.transpileModule(
  readFileSync(new URL('./login-hero-animation.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const sandbox = { exports: {} }
vm.runInNewContext(compiled, sandbox)
const startAnimation = sandbox.exports.startLoginHeroMessageAnimation

function fixture({ desktop = true, reducedMotion = false, visibility = 'visible' } = {}) {
  const listeners = () => {
    const entries = new Set()
    return {
      addEventListener: (_event, listener) => entries.add(listener),
      removeEventListener: (_event, listener) => entries.delete(listener),
      emit: () => [...entries].forEach(listener => listener()),
      count: () => entries.size,
    }
  }
  const desktopMedia = { ...listeners(), matches: desktop }
  const motionMedia = { ...listeners(), matches: reducedMotion }
  const document = { ...listeners(), visibilityState: visibility }
  const timers = new Map()
  let now = 0
  let nextId = 0
  const browser = {
    matchMedia: query => query.includes('min-width') ? desktopMedia : motionMedia,
    document,
    setTimeout: (callback, delay) => {
      timers.set(++nextId, { callback, at: now + delay })
      return nextId
    },
    clearTimeout: id => timers.delete(id),
  }
  const advance = duration => {
    const target = now + duration
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      timers.delete(next[0])
      now = next[1].at
      next[1].callback()
    }
    now = target
  }
  const text = []
  const stop = startAnimation(ending => text.push(ending), browser)
  return { browser, desktopMedia, motionMedia, document, timers, advance, text, stop }
}

test('a hero hidden by the mobile breakpoint does not schedule typing work', () => {
  const f = fixture({ desktop: false })
  assert.equal(f.timers.size, 0)
  f.advance(60_000)
  assert.deepEqual(f.text, [])
  f.desktopMedia.matches = true
  f.desktopMedia.emit()
  assert.equal(f.timers.size, 1)
  f.advance(2142)
  assert.deepEqual(f.text, ['controle'])
  f.stop()
})

test('desktop typing pauses on mobile and when the document is hidden, then resumes', () => {
  const f = fixture()
  f.advance(2142)
  assert.deepEqual(f.text, ['controle'])
  f.desktopMedia.matches = false
  f.desktopMedia.emit()
  assert.equal(f.timers.size, 0)
  f.advance(30_000)
  assert.deepEqual(f.text, ['controle'])
  f.desktopMedia.matches = true
  f.desktopMedia.emit()
  f.advance(42)
  assert.equal(f.text.at(-1), 'control')
  f.document.visibilityState = 'hidden'
  f.document.emit()
  assert.equal(f.timers.size, 0)
  f.advance(30_000)
  assert.equal(f.text.at(-1), 'control')
  f.document.visibilityState = 'visible'
  f.document.emit()
  f.advance(42)
  assert.equal(f.text.at(-1), 'contro')
  f.stop()
})

test('visible desktop retains the full word cycle and its hold, deletion and typing delays', () => {
  const f = fixture()
  f.advance(2100)
  assert.deepEqual(f.text, [])
  f.advance('controle.'.length * 42)
  assert.equal(f.text.at(-1), '')
  f.advance(240)
  assert.equal(f.text.at(-1), '')
  f.advance('organização.'.length * 72)
  assert.equal(f.text.at(-1), 'organização.')
  const completedWordUpdates = f.text.length
  f.advance(2099)
  assert.equal(f.text.length, completedWordUpdates)
  f.advance(43)
  assert.equal(f.text.at(-1), 'organização')
  f.stop()
})

test('reduced motion stays static and immediately cancels an active animation', () => {
  const f = fixture({ reducedMotion: true })
  assert.equal(f.timers.size, 0)
  f.advance(30_000)
  assert.deepEqual(f.text, [])
  f.motionMedia.matches = false
  f.motionMedia.emit()
  f.advance(2142)
  assert.equal(f.text.at(-1), 'controle')
  f.motionMedia.matches = true
  f.motionMedia.emit()
  assert.equal(f.text.at(-1), 'controle.')
  assert.equal(f.timers.size, 0)
  f.advance(30_000)
  assert.equal(f.text.length, 2)
  f.stop()
})

test('a stale queued callback cannot restart typing after a pause or unmount', () => {
  const f = fixture()
  const staleCallback = [...f.timers.values()][0].callback
  f.document.visibilityState = 'hidden'
  f.document.emit()
  f.document.visibilityState = 'visible'
  f.document.emit()
  staleCallback()
  assert.equal(f.timers.size, 1)
  assert.deepEqual(f.text, [])
  const pendingCallback = [...f.timers.values()][0].callback
  f.stop()
  pendingCallback()
  assert.equal(f.timers.size, 0)
  assert.equal(f.desktopMedia.count(), 0)
  assert.equal(f.motionMedia.count(), 0)
  assert.equal(f.document.count(), 0)
  assert.deepEqual(f.text, [])
})

test('a document already hidden on mount waits for visibility before scheduling', () => {
  const f = fixture({ visibility: 'hidden' })
  assert.equal(f.timers.size, 0)
  f.document.visibilityState = 'visible'
  f.document.emit()
  assert.equal(f.timers.size, 1)
  f.stop()
})
